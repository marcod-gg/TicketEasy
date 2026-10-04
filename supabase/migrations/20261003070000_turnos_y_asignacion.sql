-- Turnos, guardias, feriados y asignación automática (diagrama: Documentación → Cómo se asignan los tickets).
--
-- Equipo           workspace_staff.attends: un owner o supervisor que además atiende tickets (un agente siempre atiende).
--                  workspace_staff.active: quien atiende puede estar inactivo (vacaciones, licencia): no recibe asignaciones.
-- Horario semanal  company_settings.timezone + company_hours (rangos por día ISO: 1 = lunes … 7 = domingo), del admin de la empresa.
--                  staff_hours por persona y workspace: si tiene rangos, reemplazan los de la empresa.
--                  Sin rangos en ningún lado = siempre en turno (la asignación funciona sin configurar nada).
-- Guardias         staff_guards: turno de una fecha puntual (p. ej. un feriado o un sábado), aparte del horario semanal.
-- Feriados         holidays: de la empresa (workspace_id null) o de un workspace. Solo cuentan si workspaces.holidays_enabled:
--                  ese día nadie está en turno salvo quien tenga guardia.
-- Asignación       workspaces.auto_assign_enabled. Al crear un ticket sin asignado, entre quienes atienden la categoría y están
--                  activos: si alguien está en turno, el de menos tickets abiertos (empate: el que recibió uno hace más tiempo);
--                  si nadie está en turno, el que entra antes en turno (empate: menos carga). Sin nadie activo, queda sin asignar.
-- ponytail: rangos dentro del día (no cruzan medianoche) y próximo turno buscado en los 14 días siguientes.

-- ── Equipo ──────────────────────────────────────────────────────────────
alter table ticketeasy.workspace_staff
  add column attends boolean not null default false,
  add column active boolean not null default true;
update ticketeasy.workspace_staff set attends = true where role = 'agent';
alter table ticketeasy.workspace_staff add constraint workspace_staff_agente_atiende check (role <> 'agent' or attends);

-- ── Horarios, guardias y feriados ───────────────────────────────────────
create table ticketeasy.company_settings (
  company_id uuid primary key references public.empresas on delete cascade,
  timezone text not null default 'America/Santiago'
);
create table ticketeasy.company_hours (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.empresas on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null check (ends > starts)
);
create index on ticketeasy.company_hours (company_id, weekday);
create table ticketeasy.staff_hours (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  user_id uuid not null references public.usuarios on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  starts time not null,
  ends time not null check (ends > starts)
);
create index on ticketeasy.staff_hours (workspace_id, user_id, weekday);
create table ticketeasy.staff_guards (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  user_id uuid not null references public.usuarios on delete cascade,
  day date not null,
  starts time not null,
  ends time not null check (ends > starts),
  note text check (char_length(note) <= 120)
);
create index on ticketeasy.staff_guards (workspace_id, user_id, day);
create table ticketeasy.holidays (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.empresas on delete cascade,
  workspace_id uuid references ticketeasy.workspaces on delete cascade,   -- null = de toda la empresa
  day date not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  unique nulls not distinct (company_id, workspace_id, day)
);

alter table ticketeasy.workspaces
  add column auto_assign_enabled boolean not null default false,
  add column holidays_enabled boolean not null default false;

-- El feriado de un workspace debe ser de su empresa; la guardia, de alguien del equipo
create function private.te_feriado_misma_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.workspace_id is not null and private.te_empresa(new.workspace_id) <> new.company_id then
    raise exception 'El workspace no es de esa empresa' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger te_feriado_misma_empresa before insert or update on ticketeasy.holidays
for each row execute function private.te_feriado_misma_empresa();

create function private.te_guardia_del_equipo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from ticketeasy.workspace_staff where workspace_id = new.workspace_id and user_id = new.user_id) then
    raise exception 'Esa persona no es del equipo de este workspace' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger te_guardia_del_equipo before insert or update on ticketeasy.staff_guards
for each row execute function private.te_guardia_del_equipo();

-- Lectura: miembros (empresa) y equipo o quien administra (workspace). Escritura: el admin de la empresa (empresa) y quien
-- administra el workspace (guardias, feriados del workspace). La semana se reemplaza completa por las funciones de abajo
alter table ticketeasy.company_settings enable row level security;
alter table ticketeasy.company_hours enable row level security;
alter table ticketeasy.staff_hours enable row level security;
alter table ticketeasy.staff_guards enable row level security;
alter table ticketeasy.holidays enable row level security;
create policy ver on ticketeasy.company_settings for select to authenticated using (private.rol_en_empresa(company_id) is not null);
create policy ver on ticketeasy.company_hours for select to authenticated using (private.rol_en_empresa(company_id) is not null);
create policy ver on ticketeasy.staff_hours for select to authenticated using (private.te_es_equipo(workspace_id) or private.te_administra(workspace_id));
create policy ver on ticketeasy.staff_guards for select to authenticated using (private.te_es_equipo(workspace_id) or private.te_administra(workspace_id));
create policy administrar on ticketeasy.staff_guards for all to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo')
  with check (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');
create policy ver on ticketeasy.holidays for select to authenticated using (private.rol_en_empresa(company_id) is not null);
create policy administrar on ticketeasy.holidays for all to authenticated
  using (private.te_acceso(company_id) = 'completo' and (case when workspace_id is null then private.rol_en_empresa(company_id) = 'admin'
    else private.te_administra(workspace_id) end))
  with check (private.te_acceso(company_id) = 'completo' and (case when workspace_id is null then private.rol_en_empresa(company_id) = 'admin'
    else private.te_administra(workspace_id) end));
grant select on ticketeasy.company_settings, ticketeasy.company_hours, ticketeasy.staff_hours to authenticated;
grant select, insert, update, delete on ticketeasy.staff_guards, ticketeasy.holidays to authenticated;

-- p_hours: [{ "weekday": 1..7, "starts": "09:00", "ends": "18:00" }, …]
create function private.te_validar_rangos(p_hours jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(p_hours) <> 'array' then raise exception 'El horario debe ser una lista de rangos' using errcode = 'check_violation'; end if;
  if exists (select 1 from jsonb_to_recordset(p_hours) r(weekday int, starts time, ends time)
             where r.weekday not between 1 and 7 or r.ends <= r.starts) then
    raise exception 'Cada rango necesita un día de 1 a 7 y una hora de término posterior a la de inicio' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from rows from (jsonb_to_recordset(p_hours) as (weekday int, starts time, ends time)) with ordinality a(weekday, starts, ends, n)
    join rows from (jsonb_to_recordset(p_hours) as (weekday int, starts time, ends time)) with ordinality b(weekday, starts, ends, n)
      on a.n < b.n and a.weekday = b.weekday and a.starts < b.ends and b.starts < a.ends) then
    raise exception 'Hay rangos que se superponen en el mismo día' using errcode = 'check_violation';
  end if;
end $$;

create function ticketeasy.set_company_hours(p_company uuid, p_timezone text, p_hours jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.rol_en_empresa(p_company) is distinct from 'admin' or private.te_acceso(p_company) is distinct from 'completo' then
    raise exception 'Solo el admin de la empresa define su horario' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Zona horaria desconocida: %', p_timezone using errcode = 'check_violation';
  end if;
  perform private.te_validar_rangos(p_hours);
  insert into ticketeasy.company_settings (company_id, timezone) values (p_company, p_timezone)
  on conflict (company_id) do update set timezone = excluded.timezone;
  delete from ticketeasy.company_hours where company_id = p_company;
  insert into ticketeasy.company_hours (company_id, weekday, starts, ends)
  select p_company, weekday, starts, ends from jsonb_to_recordset(p_hours) r(weekday smallint, starts time, ends time);
end $$;

-- p_hours null = usa el horario de la empresa
create function ticketeasy.set_staff_hours(p_ws uuid, p_user uuid, p_hours jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.te_administra(p_ws) or private.te_acceso(private.te_empresa(p_ws)) is distinct from 'completo' then
    raise exception 'Solo quien administra el workspace define los horarios de su equipo' using errcode = '42501';
  end if;
  if not exists (select 1 from ticketeasy.workspace_staff where workspace_id = p_ws and user_id = p_user) then
    raise exception 'Esa persona no es del equipo de este workspace' using errcode = 'check_violation';
  end if;
  delete from ticketeasy.staff_hours where workspace_id = p_ws and user_id = p_user;
  if p_hours is not null then
    perform private.te_validar_rangos(p_hours);
    insert into ticketeasy.staff_hours (workspace_id, user_id, weekday, starts, ends)
    select p_ws, p_user, weekday, starts, ends from jsonb_to_recordset(p_hours) r(weekday smallint, starts time, ends time);
  end if;
end $$;

-- ── En turno y próximo turno ────────────────────────────────────────────
create function private.te_zona(ws uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select timezone from ticketeasy.company_settings where company_id = private.te_empresa(ws)), 'America/Santiago')
$$;

-- Rangos de un día local para esa persona: guardias de la fecha; con feriado (si cuentan) solo esas; si no, además su
-- semana (la propia o la de la empresa). Sin ningún horario configurado: todo el día
create function private.te_rangos_del_dia(ws uuid, uid uuid, dia date) returns table (starts time, ends time)
language plpgsql stable security definer set search_path = '' as $$
declare
  empresa uuid := private.te_empresa(ws);
  feriado boolean := (select holidays_enabled from ticketeasy.workspaces where id = ws)
    and exists (select 1 from ticketeasy.holidays h where h.company_id = empresa and h.day = dia and (h.workspace_id is null or h.workspace_id = ws));
begin
  return query select g.starts, g.ends from ticketeasy.staff_guards g where g.workspace_id = ws and g.user_id = uid and g.day = dia;
  if feriado then return; end if;
  if exists (select 1 from ticketeasy.staff_hours where workspace_id = ws and user_id = uid) then
    return query select s.starts, s.ends from ticketeasy.staff_hours s
      where s.workspace_id = ws and s.user_id = uid and s.weekday = extract(isodow from dia);
  elsif exists (select 1 from ticketeasy.company_hours where company_id = empresa) then
    return query select c.starts, c.ends from ticketeasy.company_hours c where c.company_id = empresa and c.weekday = extract(isodow from dia);
  else
    return query select time '00:00', time '23:59:59.999999';
  end if;
end $$;

create function private.te_en_turno(ws uuid, uid uuid, ts timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.te_rangos_del_dia(ws, uid, (ts at time zone private.te_zona(ws))::date) r
                 where (ts at time zone private.te_zona(ws))::time >= r.starts and (ts at time zone private.te_zona(ws))::time < r.ends)
$$;

-- Próximo inicio de turno desde ts (en los 14 días siguientes), o null
create function private.te_proximo_turno(ws uuid, uid uuid, ts timestamptz default now()) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := private.te_zona(ws);
  l timestamp := ts at time zone tz;
  d int;
  inicio time;
begin
  for d in 0..13 loop
    select min(r.starts) into inicio from private.te_rangos_del_dia(ws, uid, l::date + d) r
    where d > 0 or r.starts > l::time;
    if inicio is not null then return ((l::date + d) + inicio) at time zone tz; end if;
  end loop;
  return null;
end $$;

-- ── Asignación automática ───────────────────────────────────────────────
create function private.te_autoasignar(ws uuid, cat uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  with candidatos as (
    select distinct s.user_id from ticketeasy.workspace_staff s
    where s.workspace_id = ws and s.attends and s.active and s.user_id = any (private.te_equipo_que_cubre(ws, cat))),
  datos as (
    select c.user_id,
      private.te_en_turno(ws, c.user_id) as en_turno,
      private.te_proximo_turno(ws, c.user_id) as proximo,
      (select count(*) from ticketeasy.tickets t where t.workspace_id = ws and t.assignee_id = c.user_id
         and t.status in ('new', 'triaged', 'in_progress', 'on_hold', 'pending_requester', 'reopened', 'escalated')) as carga,
      (select max(t.created_at) from ticketeasy.tickets t where t.workspace_id = ws and t.assignee_id = c.user_id) as ultimo
    from candidatos c)
  select user_id from datos
  order by en_turno desc,
    case when en_turno then null else proximo end nulls last,
    carga, ultimo nulls first, user_id
  limit 1
$$;

-- Corre después de te_ticket_al_crear (orden alfabético), que completa company_id
create function private.te_ticket_autoasignar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_id is null and (select auto_assign_enabled from ticketeasy.workspaces where id = new.workspace_id) then
    new.assignee_id := private.te_autoasignar(new.workspace_id, new.category_id);
  end if;
  return new;
end $$;
create trigger te_ticket_autoasignar before insert on ticketeasy.tickets
for each row execute function private.te_ticket_autoasignar();

-- Al crear: el asignado recibe "asignado" (automático) y el resto del equipo "ticket nuevo"
create or replace function private.te_notif_ticket() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.te_notificar(new, 'new_ticket',
      array_remove(private.te_equipo_que_cubre(new.workspace_id, new.category_id) || new.requester_id, new.assignee_id));
    if new.assignee_id is not null then
      perform private.te_notificar(new, 'assigned', array[new.assignee_id], jsonb_build_object('auto', true));
    end if;
    return null;
  end if;
  if new.status <> old.status then
    perform private.te_notificar(new, 'status', array[new.requester_id, new.assignee_id], jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform private.te_notificar(new, 'assigned', array[new.assignee_id]);
  end if;
  return null;
end $$;

-- ── Ajustes de atención: suman asignación automática y feriados ─────────
drop function ticketeasy.update_service_settings(uuid, boolean, int, boolean);
create function ticketeasy.update_service_settings(p_ws uuid, p_autoclose_enabled boolean, p_autoclose_hours int, p_survey_enabled boolean,
  p_auto_assign_enabled boolean, p_holidays_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.te_publica(p_ws) or private.te_acceso(private.te_empresa(p_ws)) is distinct from 'completo' then
    raise exception 'No puedes cambiar los ajustes de atención de este workspace' using errcode = '42501';
  end if;
  update ticketeasy.workspaces
  set autoclose_enabled = p_autoclose_enabled, autoclose_hours = p_autoclose_hours, survey_enabled = p_survey_enabled,
      auto_assign_enabled = p_auto_assign_enabled, holidays_enabled = p_holidays_enabled
  where id = p_ws;
end $$;

revoke execute on function private.te_validar_rangos(jsonb), private.te_zona(uuid), private.te_rangos_del_dia(uuid, uuid, date),
  private.te_en_turno(uuid, uuid, timestamptz), private.te_proximo_turno(uuid, uuid, timestamptz), private.te_autoasignar(uuid, uuid),
  private.te_ticket_autoasignar(), private.te_feriado_misma_empresa(), private.te_guardia_del_equipo() from public, anon;
revoke execute on function ticketeasy.set_company_hours(uuid, text, jsonb), ticketeasy.set_staff_hours(uuid, uuid, jsonb),
  ticketeasy.update_service_settings(uuid, boolean, int, boolean, boolean, boolean) from public, anon;
grant execute on function ticketeasy.set_company_hours(uuid, text, jsonb), ticketeasy.set_staff_hours(uuid, uuid, jsonb),
  ticketeasy.update_service_settings(uuid, boolean, int, boolean, boolean, boolean) to authenticated;
