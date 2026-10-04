-- Pendiente de respuesta, cierre automático y encuesta de satisfacción (como el TicketEasy anterior: estado 4,
-- AutoCloseRunner y Feedback). Ambos se configuran por workspace en Gestión → Ajustes de atención.
--
-- pending_requester  el equipo pidió información y espera al solicitante (En pausa queda para esperas de terceros).
--                    Cuando el solicitante responde en la conversación, vuelve solo a En curso.
-- Cierre automático  si está activo y pasan autoclose_hours sin respuesta, se cancela con motivo no_response.
--                    A la mitad del plazo el solicitante recibe un recordatorio. Lo corre pg_cron cada 15 minutos.
-- Encuesta           si está activa, el solicitante califica el ticket cerrado: 1 a 5 estrellas, etiquetas y comentario.

create extension if not exists pg_cron;

-- ── Estado nuevo y motivo automático ────────────────────────────────────
alter table ticketeasy.tickets drop constraint tickets_status_check;
alter table ticketeasy.tickets add constraint tickets_status_check
  check (status in ('new', 'triaged', 'in_progress', 'on_hold', 'pending_requester', 'resolved', 'reopened', 'escalated', 'closed', 'cancelled'));
alter table ticketeasy.tickets drop constraint tickets_cancel_reason_check;
alter table ticketeasy.tickets add constraint tickets_cancel_reason_check
  check (cancel_reason in ('duplicate', 'not_applicable', 'announcement', 'withdrawn', 'other', 'no_response'));
alter table ticketeasy.tickets
  add column awaiting_since timestamptz,   -- desde cuándo espera al solicitante (lo mantiene te_ticket_espera)
  add column reminded_at timestamptz;      -- recordatorio de cierre automático ya enviado

-- Mismo mapa que PASOS en wwwroot/js/app.js
create or replace function private.te_transicion_valida(de text, a text) returns boolean
language sql immutable set search_path = '' as $$
  select (de, a) in (
    ('new', 'triaged'),
    ('triaged', 'in_progress'),
    ('in_progress', 'on_hold'), ('in_progress', 'pending_requester'), ('in_progress', 'resolved'), ('in_progress', 'escalated'),
    ('on_hold', 'in_progress'), ('on_hold', 'escalated'),
    ('pending_requester', 'in_progress'),
    ('resolved', 'closed'), ('resolved', 'reopened'),
    ('reopened', 'in_progress'),
    ('escalated', 'triaged'))
    or (a = 'cancelled' and de in ('new', 'triaged', 'in_progress', 'on_hold', 'pending_requester', 'reopened', 'escalated'))
$$;

-- Marca el inicio de la espera; corre después de te_ticket_al_actualizar y te_ticket_al_cancelar (orden alfabético)
create function private.te_ticket_espera() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'pending_requester' and old.status <> 'pending_requester' then
    new.awaiting_since := now();
    new.reminded_at := null;
  elsif new.status <> 'pending_requester' then
    new.awaiting_since := null;
    new.reminded_at := null;
  end if;
  return new;
end $$;
create trigger te_ticket_espera before update of status on ticketeasy.tickets
for each row execute function private.te_ticket_espera();

-- Si el solicitante responde un ticket que lo espera, vuelve a En curso
create or replace function private.te_mensaje_al_crear() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t ticketeasy.tickets;
begin
  select * into t from ticketeasy.tickets where id = new.ticket_id;
  new.author_role := coalesce(private.te_rol(t.workspace_id, t.category_id), 'requester');
  if new.kind = 'reply' and t.status = 'pending_requester' and new.author_id = t.requester_id then
    update ticketeasy.tickets set status = 'in_progress' where id = new.ticket_id;
  elsif new.kind <> 'system' then
    update ticketeasy.tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return new;
end $$;

-- ── Ajustes de atención por workspace ───────────────────────────────────
alter table ticketeasy.workspaces
  add column autoclose_enabled boolean not null default false,
  add column autoclose_hours int not null default 48 check (autoclose_hours between 1 and 720),
  add column survey_enabled boolean not null default false;

-- Los cambia quien publica comunicados (owner, supervisor de todo el workspace o admin de la empresa): la política
-- de workspaces solo deja editar al owner y al admin, así que va por aquí
create function ticketeasy.update_service_settings(p_ws uuid, p_autoclose_enabled boolean, p_autoclose_hours int, p_survey_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.te_publica(p_ws) or private.te_acceso(private.te_empresa(p_ws)) is distinct from 'completo' then
    raise exception 'No puedes cambiar los ajustes de atención de este workspace' using errcode = '42501';
  end if;
  update ticketeasy.workspaces
  set autoclose_enabled = p_autoclose_enabled, autoclose_hours = p_autoclose_hours, survey_enabled = p_survey_enabled
  where id = p_ws;
end $$;
revoke execute on function ticketeasy.update_service_settings(uuid, boolean, int, boolean) from public, anon;
grant execute on function ticketeasy.update_service_settings(uuid, boolean, int, boolean) to authenticated;

-- ── Cierre automático ───────────────────────────────────────────────────
alter table ticketeasy.notifications drop constraint notifications_kind_check;
alter table ticketeasy.notifications add constraint notifications_kind_check
  check (kind in ('new_ticket', 'message', 'status', 'assigned', 'reminder'));

-- Corre sin sesión (auth.uid() es null): los avisos de estado llegan al solicitante y al asignado por te_notif_ticket
create function private.te_autocierre() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  for r in
    select t.id, t.requester_id, t.company_id, t.workspace_id, t.subject, t.awaiting_since, t.reminded_at, w.autoclose_hours as horas
    from ticketeasy.tickets t join ticketeasy.workspaces w on w.id = t.workspace_id
    where t.status = 'pending_requester' and w.autoclose_enabled and t.awaiting_since is not null
  loop
    if r.awaiting_since + make_interval(hours => r.horas) <= now() then
      update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'no_response' where id = r.id;
      insert into ticketeasy.ticket_messages (ticket_id, kind, body)
      values (r.id, 'system', format('Cancelado automáticamente: sin respuesta del solicitante en %s h', r.horas));
    elsif r.reminded_at is null and r.awaiting_since + make_interval(hours => r.horas) / 2 <= now() then
      insert into ticketeasy.notifications (user_id, company_id, workspace_id, ticket_id, kind, data)
      values (r.requester_id, r.company_id, r.workspace_id, r.id, 'reminder',
              jsonb_build_object('subject', r.subject, 'closes_at', r.awaiting_since + make_interval(hours => r.horas)));
      update ticketeasy.tickets set reminded_at = now() where id = r.id;
    end if;
  end loop;
end $$;
revoke execute on function private.te_autocierre() from public, anon, authenticated;

select cron.schedule('ticketeasy-autocierre', '*/15 * * * *', 'select private.te_autocierre()');

-- ── Encuesta de satisfacción ────────────────────────────────────────────
-- Etiquetas como las de Uber: elogios con 4–5 estrellas y problemas con 1–3
create table ticketeasy.ticket_feedback (
  ticket_id bigint primary key references ticketeasy.tickets on delete cascade,
  requester_id uuid not null default auth.uid() references public.usuarios on delete cascade,
  rating int not null check (rating between 1 and 5),
  tags text[] not null default '{}' check (
    case when rating >= 4 then tags <@ array['fast', 'solved', 'communication', 'kind', 'clear']
         else tags <@ array['slow', 'unsolved', 'poor_communication', 'had_to_insist', 'unclear'] end),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);

alter table ticketeasy.ticket_feedback enable row level security;
-- La ve el solicitante y el equipo que ve el ticket
create policy ver on ticketeasy.ticket_feedback for select to authenticated
  using (requester_id = (select auth.uid()) or exists (select 1 from ticketeasy.tickets t where t.id = ticket_id
    and private.te_rol(t.workspace_id, t.category_id) is not null));
-- Una vez por ticket, solo el solicitante, con el ticket cerrado y la encuesta activa en su workspace
create policy calificar on ticketeasy.ticket_feedback for insert to authenticated
  with check (requester_id = (select auth.uid()) and exists (
    select 1 from ticketeasy.tickets t join ticketeasy.workspaces w on w.id = t.workspace_id
    where t.id = ticket_id and t.requester_id = (select auth.uid()) and t.status = 'closed' and w.survey_enabled
      and private.te_acceso(t.company_id) = 'completo'));
grant select, insert on ticketeasy.ticket_feedback to authenticated;
