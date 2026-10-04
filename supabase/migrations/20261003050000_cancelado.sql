-- Estado "cancelado": un ticket que no se va a atender. Lo cancela el equipo (misma política que los demás cambios
-- de estado) desde cualquier estado abierto anterior a Resuelto; es final, como Cerrado. Siempre con motivo:
--   duplicate      duplicado de otro ticket del mismo workspace (duplicate_of)
--   not_applicable no corresponde a este workspace o a la mesa de ayuda
--   announcement   ya informado en un comunicado del workspace (announcement_id), p. ej. una caída general
--   withdrawn      el solicitante ya no lo necesita
--   other          otro motivo
-- El detalle para el solicitante va como respuesta en la conversación (la app lo pide salvo en duplicado y comunicado).

alter table ticketeasy.tickets drop constraint tickets_status_check;
alter table ticketeasy.tickets add constraint tickets_status_check
  check (status in ('new', 'triaged', 'in_progress', 'on_hold', 'resolved', 'reopened', 'escalated', 'closed', 'cancelled'));

alter table ticketeasy.tickets
  add column cancel_reason text check (cancel_reason in ('duplicate', 'not_applicable', 'announcement', 'withdrawn', 'other')),
  add column duplicate_of bigint references ticketeasy.tickets on delete set null,
  add column announcement_id bigint references ticketeasy.announcements on delete set null,
  add column cancelled_at timestamptz,
  add constraint tickets_cancelacion_check check (
    (status = 'cancelled') = (cancel_reason is not null)
    and (duplicate_of is null or cancel_reason = 'duplicate')
    and (announcement_id is null or cancel_reason = 'announcement'));

-- Mismo mapa que PASOS en wwwroot/js/app.js
create or replace function private.te_transicion_valida(de text, a text) returns boolean
language sql immutable set search_path = '' as $$
  select (de, a) in (
    ('new', 'triaged'),
    ('triaged', 'in_progress'),
    ('in_progress', 'on_hold'), ('in_progress', 'resolved'), ('in_progress', 'escalated'),
    ('on_hold', 'in_progress'), ('on_hold', 'escalated'),
    ('resolved', 'closed'), ('resolved', 'reopened'),
    ('reopened', 'in_progress'),
    ('escalated', 'triaged'))
    or (a = 'cancelled' and de in ('new', 'triaged', 'in_progress', 'on_hold', 'reopened', 'escalated'))
$$;

-- Cancelar exige el motivo y su referencia; el duplicado y el comunicado deben ser del mismo workspace.
-- Los triggers corren en orden alfabético: te_ticket_al_actualizar (valida la transición y deja el mensaje de sistema)
-- y después este, que valida el motivo y marca la fecha. Si este falla, se revierte todo el cambio.
create function private.te_ticket_al_cancelar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if new.cancel_reason is null then
      raise exception 'Indica por qué se cancela el ticket' using errcode = 'check_violation';
    end if;
    if new.cancel_reason = 'duplicate' and not exists (
        select 1 from ticketeasy.tickets d where d.id = new.duplicate_of and d.workspace_id = new.workspace_id and d.id <> new.id) then
      raise exception 'El ticket original debe ser otro ticket de este workspace' using errcode = 'check_violation';
    end if;
    if new.cancel_reason = 'announcement' and not exists (
        select 1 from ticketeasy.announcements a where a.id = new.announcement_id and a.workspace_id = new.workspace_id) then
      raise exception 'Elige un comunicado de este workspace' using errcode = 'check_violation';
    end if;
    new.cancelled_at := now();
  elsif old.status = 'cancelled' or new.status <> 'cancelled' then
    -- El motivo solo se escribe al cancelar
    if new.cancel_reason is distinct from old.cancel_reason or new.duplicate_of is distinct from old.duplicate_of
      or new.announcement_id is distinct from old.announcement_id then
      raise exception 'El motivo de cancelación se indica solo al cancelar' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger te_ticket_al_cancelar before update on ticketeasy.tickets
for each row execute function private.te_ticket_al_cancelar();

revoke execute on function private.te_ticket_al_cancelar() from public, anon;
