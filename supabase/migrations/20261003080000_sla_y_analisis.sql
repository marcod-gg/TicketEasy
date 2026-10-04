-- SLA y análisis de datos (Gestión → Análisis de datos).
--
-- Historial    ticket_events: cada cambio de estado con su hora (lo escribe un trigger; se rellena desde los mensajes de sistema).
-- Metas        sla_targets por workspace y prioridad: minutos hábiles para la primera respuesta y para la resolución.
--              workspaces.sla_enabled las activa. Las configura quien gestiona el workspace (te_publica).
-- Reloj        solo minutos hábiles del agente asignado (su horario, guardias y feriados, como te_rangos_del_dia); sin asignado,
--              el horario de la empresa. Se detiene mientras el ticket está en Pendiente de respuesta o En espera de terceros.
-- Primera respuesta  la primera respuesta pública del equipo. Resolución: hasta Resuelto (resolved_at).
-- ponytail: se calcula al consultar (día por día); guardar los tiempos al cambiar de estado si el volumen lo pide.

-- ── Historial de estados ────────────────────────────────────────────────
create table ticketeasy.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references ticketeasy.tickets on delete cascade,
  from_status text,
  to_status text not null,
  at timestamptz not null default now()
);
create index on ticketeasy.ticket_events (ticket_id, at);
alter table ticketeasy.ticket_events enable row level security;
create policy ver on ticketeasy.ticket_events for select to authenticated
  using (exists (select 1 from ticketeasy.tickets t where t.id = ticket_id));
grant select on ticketeasy.ticket_events to authenticated;

create function private.te_ticket_evento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into ticketeasy.ticket_events (ticket_id, from_status, to_status, at) values (new.id, null, new.status, new.created_at);
  elsif new.status <> old.status then
    insert into ticketeasy.ticket_events (ticket_id, from_status, to_status) values (new.id, old.status, new.status);
  end if;
  return null;
end $$;
create trigger te_ticket_evento after insert or update of status on ticketeasy.tickets
for each row execute function private.te_ticket_evento();

-- Relleno: alta de cada ticket y los cambios que quedaron como mensaje de sistema "de → a"
insert into ticketeasy.ticket_events (ticket_id, from_status, to_status, at)
select id, null, 'new', created_at from ticketeasy.tickets;
insert into ticketeasy.ticket_events (ticket_id, from_status, to_status, at)
select m.ticket_id, split_part(m.body, ' → ', 1), split_part(m.body, ' → ', 2), m.created_at
from ticketeasy.ticket_messages m
where m.kind = 'system' and m.body ~ '^[a-z_]+ → [a-z_]+$';
-- Cancelados por el cierre automático (su mensaje de sistema es un texto)
insert into ticketeasy.ticket_events (ticket_id, from_status, to_status, at)
select t.id, 'pending_requester', 'cancelled', t.cancelled_at from ticketeasy.tickets t
where t.cancel_reason = 'no_response' and t.cancelled_at is not null
  and not exists (select 1 from ticketeasy.ticket_events e where e.ticket_id = t.id and e.to_status = 'cancelled');

-- ── Metas ───────────────────────────────────────────────────────────────
alter table ticketeasy.workspaces add column sla_enabled boolean not null default false;
create table ticketeasy.sla_targets (
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  priority text not null check (priority in ('low', 'medium', 'high', 'urgent')),
  first_response_minutes int not null check (first_response_minutes between 1 and 100000),
  resolution_minutes int not null check (resolution_minutes between 1 and 1000000),
  primary key (workspace_id, priority)
);
alter table ticketeasy.sla_targets enable row level security;
create policy ver on ticketeasy.sla_targets for select to authenticated
  using (private.te_es_equipo(workspace_id) or private.te_publica(workspace_id));
grant select on ticketeasy.sla_targets to authenticated;

-- p_targets: [{ "priority": "urgent", "first_response_minutes": 60, "resolution_minutes": 480 }, …]
create function ticketeasy.set_sla(p_ws uuid, p_enabled boolean, p_targets jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.te_publica(p_ws) or private.te_acceso(private.te_empresa(p_ws)) is distinct from 'completo' then
    raise exception 'No puedes configurar el SLA de este workspace' using errcode = '42501';
  end if;
  update ticketeasy.workspaces set sla_enabled = p_enabled where id = p_ws;
  delete from ticketeasy.sla_targets where workspace_id = p_ws;
  insert into ticketeasy.sla_targets (workspace_id, priority, first_response_minutes, resolution_minutes)
  select p_ws, priority, first_response_minutes, resolution_minutes
  from jsonb_to_recordset(p_targets) r(priority text, first_response_minutes int, resolution_minutes int);
end $$;

-- ── Reloj hábil ─────────────────────────────────────────────────────────
-- Minutos hábiles entre a y b según el horario de uid en ws (uid null = horario de la empresa)
create function private.te_minutos_habiles(ws uuid, uid uuid, a timestamptz, b timestamptz) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := private.te_zona(ws);
  la timestamp := a at time zone tz;
  lb timestamp := b at time zone tz;
  d date;
  total numeric := 0;
begin
  if b <= a then return 0; end if;
  for d in select generate_series(la::date, lb::date, interval '1 day')::date loop
    select total + coalesce(sum(extract(epoch from (least(d + r.ends, lb) - greatest(d + r.starts, la))) / 60), 0) into total
    from private.te_rangos_del_dia(ws, uid, d) r
    where least(d + r.ends, lb) > greatest(d + r.starts, la);
  end loop;
  return total;
end $$;

-- Minutos hábiles de [a, b) en que el ticket estuvo en una espera (Pendiente de respuesta, En espera de terceros)
create function private.te_minutos_en_espera(t bigint, ws uuid, uid uuid, a timestamptz, b timestamptz) returns numeric
language sql stable security definer set search_path = '' as $$
  with tramos as (
    select e.to_status, e.at as desde, coalesce(lead(e.at) over (order by e.at, e.id), now()) as hasta
    from ticketeasy.ticket_events e where e.ticket_id = t)
  select coalesce(sum(private.te_minutos_habiles(ws, uid, greatest(desde, a), least(hasta, b))), 0)
  from tramos where to_status in ('pending_requester', 'on_hold') and least(hasta, b) > greatest(desde, a)
$$;

-- SLA de un ticket: minutos hábiles (sin esperas) hasta la primera respuesta y hasta la resolución, o hasta ahora si sigue abierto
create function private.te_sla_ticket(t ticketeasy.tickets) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  meta ticketeasy.sla_targets;
  respuesta timestamptz := (select min(m.created_at) from ticketeasy.ticket_messages m
    where m.ticket_id = t.id and m.kind = 'reply' and m.author_role <> 'requester');
  fin_r timestamptz;
  fin_s timestamptz;
  min_r numeric;
  min_s numeric;
begin
  select * into meta from ticketeasy.sla_targets where workspace_id = t.workspace_id and priority = t.priority;
  fin_r := coalesce(respuesta, case when t.status in ('closed', 'cancelled') then coalesce(t.closed_at, t.cancelled_at) else now() end);
  fin_s := coalesce(t.resolved_at, case when t.status = 'cancelled' then t.cancelled_at else now() end);
  min_r := private.te_minutos_habiles(t.workspace_id, t.assignee_id, t.created_at, fin_r)
         - private.te_minutos_en_espera(t.id, t.workspace_id, t.assignee_id, t.created_at, fin_r);
  min_s := private.te_minutos_habiles(t.workspace_id, t.assignee_id, t.created_at, fin_s)
         - private.te_minutos_en_espera(t.id, t.workspace_id, t.assignee_id, t.created_at, fin_s);
  return jsonb_build_object(
    'responded', respuesta is not null, 'resolved', t.resolved_at is not null,
    'first_response_minutes', round(greatest(min_r, 0)), 'resolution_minutes', round(greatest(min_s, 0)),
    'first_response_target', meta.first_response_minutes, 'resolution_target', meta.resolution_minutes);
end $$;

-- ── Análisis de datos ───────────────────────────────────────────────────
-- Tickets creados entre p_from y p_to (fechas locales del workspace, ambas incluidas). Solo para quien gestiona el workspace
create function ticketeasy.workspace_analytics(p_ws uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := private.te_zona(p_ws);
  res jsonb;
begin
  if not private.te_publica(p_ws) or private.te_acceso(private.te_empresa(p_ws)) is null then
    raise exception 'No puedes ver el análisis de este workspace' using errcode = '42501';
  end if;
  with base as (
    select t.*, private.te_sla_ticket(t) as sla, f.rating, f.tags
    from ticketeasy.tickets t left join ticketeasy.ticket_feedback f on f.ticket_id = t.id
    where t.workspace_id = p_ws and (t.created_at at time zone tz)::date between p_from and p_to),
  m as (
    select *, (sla->>'first_response_minutes')::numeric as fr, (sla->>'resolution_minutes')::numeric as rs,
      (sla->>'first_response_target')::numeric as fr_meta, (sla->>'resolution_target')::numeric as rs_meta,
      (sla->>'responded')::boolean as respondido, (sla->>'resolved')::boolean as resuelto
    from base)
  select jsonb_build_object(
    'sla_enabled', (select sla_enabled from ticketeasy.workspaces where id = p_ws),
    'totals', (select jsonb_build_object(
      'created', count(*),
      'open', count(*) filter (where status not in ('resolved', 'closed', 'cancelled')),
      'resolved', count(*) filter (where resuelto),
      'cancelled', count(*) filter (where status = 'cancelled'),
      'avg_first_response', round(avg(fr) filter (where respondido)),
      'avg_resolution', round(avg(rs) filter (where resuelto)),
      'fr_met', count(*) filter (where respondido and fr_meta is not null and fr <= fr_meta),
      'fr_measured', count(*) filter (where respondido and fr_meta is not null),
      'rs_met', count(*) filter (where resuelto and rs_meta is not null and rs <= rs_meta),
      'rs_measured', count(*) filter (where resuelto and rs_meta is not null),
      'rating_avg', round(avg(rating), 2), 'rating_count', count(rating)) from m),
    'by_day', (select coalesce(jsonb_agg(x order by x->>'day'), '[]') from (
      select jsonb_build_object('day', d::date, 'created', count(m.id), 'resolved', count(m.id) filter (where m.resuelto)) x
      from generate_series(p_from, p_to, interval '1 day') d left join m on (m.created_at at time zone tz)::date = d::date
      group by d) q),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from m group by status) q),
    'by_priority', (select coalesce(jsonb_agg(jsonb_build_object('priority', priority, 'created', n, 'fr_met', frm, 'fr_measured', frn,
        'rs_met', rsm, 'rs_measured', rsn, 'avg_resolution', avgrs) order by array_position(array['urgent', 'high', 'medium', 'low'], priority)), '[]') from (
      select priority, count(*) n,
        count(*) filter (where respondido and fr_meta is not null and fr <= fr_meta) frm, count(*) filter (where respondido and fr_meta is not null) frn,
        count(*) filter (where resuelto and rs_meta is not null and rs <= rs_meta) rsm, count(*) filter (where resuelto and rs_meta is not null) rsn,
        round(avg(rs) filter (where resuelto)) avgrs
      from m group by priority) q),
    'by_agent', (select coalesce(jsonb_agg(jsonb_build_object('user_id', assignee_id, 'assigned', n, 'open', ab, 'resolved', rv,
        'avg_resolution', avgrs, 'rs_met', rsm, 'rs_measured', rsn, 'rating_avg', rat) order by n desc), '[]') from (
      select assignee_id, count(*) n, count(*) filter (where status not in ('resolved', 'closed', 'cancelled')) ab, count(*) filter (where resuelto) rv,
        round(avg(rs) filter (where resuelto)) avgrs,
        count(*) filter (where resuelto and rs_meta is not null and rs <= rs_meta) rsm, count(*) filter (where resuelto and rs_meta is not null) rsn,
        round(avg(rating), 2) rat
      from m group by assignee_id) q),
    'ratings', (select coalesce(jsonb_object_agg(rating, n), '{}') from (select rating, count(*) n from m where rating is not null group by rating) q),
    'tags', (select coalesce(jsonb_object_agg(tag, n), '{}') from (select unnest(tags) tag, count(*) n from m where tags is not null group by 1) q),
    -- Revisión: abiertos con meta, del más comprometido al menos (uso de la meta de resolución, o de respuesta si no ha respondido)
    'at_risk', (select coalesce(jsonb_agg(x order by (x->>'used')::numeric desc), '[]') from (
      select jsonb_build_object('id', id, 'subject', subject, 'priority', priority, 'status', status, 'assignee_id', assignee_id,
        'metric', case when not respondido then 'first_response' else 'resolution' end,
        'minutes', case when not respondido then fr else rs end, 'target', case when not respondido then fr_meta else rs_meta end,
        'used', round(case when not respondido then fr / nullif(fr_meta, 0) else rs / nullif(rs_meta, 0) end, 3)) x
      from m where status not in ('resolved', 'closed', 'cancelled') and fr_meta is not null) q
      where (x->>'used')::numeric >= 0.75)
  ) into res;
  return res;
end $$;

revoke execute on function private.te_ticket_evento(), private.te_minutos_habiles(uuid, uuid, timestamptz, timestamptz),
  private.te_minutos_en_espera(bigint, uuid, uuid, timestamptz, timestamptz), private.te_sla_ticket(ticketeasy.tickets) from public, anon;
revoke execute on function ticketeasy.set_sla(uuid, boolean, jsonb), ticketeasy.workspace_analytics(uuid, date, date) from public, anon;
grant execute on function ticketeasy.set_sla(uuid, boolean, jsonb), ticketeasy.workspace_analytics(uuid, date, date) to authenticated;
