-- Notificaciones in-app, a nivel empresa: la campana junta las de todos los workspaces de la empresa.
-- Las generan triggers (security definer); el cliente solo las lee y las marca leídas. Llegan en vivo por Realtime.
-- Quién recibe (nunca quien hizo la acción):
--   ticket nuevo     el equipo que cubre la categoría, y el solicitante si lo abrió otro a su nombre
--   respuesta        solicitante y asignado; sin asignado y si escribe el solicitante, el equipo que cubre la categoría
--   nota interna     el asignado (nunca el solicitante)
--   cambio de estado solicitante y asignado
--   asignación       el nuevo asignado
-- ponytail: se guardan para siempre; purgar las leídas de más de N días con pg_cron si la tabla crece
create table ticketeasy.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.usuarios on delete cascade,
  company_id uuid not null references public.empresas on delete cascade,
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  ticket_id bigint not null references ticketeasy.tickets on delete cascade,
  kind text not null check (kind in ('new_ticket', 'message', 'status', 'assigned')),
  actor_id uuid references public.usuarios on delete set null,
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),   -- foto: subject, from/to, message_kind
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on ticketeasy.notifications (user_id, company_id, created_at desc);
create index on ticketeasy.notifications (ticket_id);

alter table ticketeasy.notifications enable row level security;
create policy ver on ticketeasy.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy marcar on ticketeasy.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on ticketeasy.notifications to authenticated;
grant update (read_at) on ticketeasy.notifications to authenticated;

-- Equipo cuyo alcance cubre la categoría (o todo el workspace si cat es null)
create function private.te_equipo_que_cubre(ws uuid, cat uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct s.user_id), '{}') from ticketeasy.workspace_staff s
  where s.workspace_id = ws
    and (s.category_id is null or s.category_id = any (coalesce((select c.path from ticketeasy.categories c where c.id = cat), '{}')))
$$;

create function private.te_notificar(t ticketeasy.tickets, tipo text, para uuid[], datos jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
  insert into ticketeasy.notifications (user_id, company_id, workspace_id, ticket_id, kind, actor_id, data)
  select distinct u, t.company_id, t.workspace_id, t.id, tipo, auth.uid(), datos || jsonb_build_object('subject', t.subject)
  from unnest(para) u
  where u is not null and u is distinct from auth.uid()
$$;

create function private.te_notif_ticket() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.te_notificar(new, 'new_ticket', private.te_equipo_que_cubre(new.workspace_id, new.category_id) || new.requester_id);
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

create trigger te_notif_ticket after insert or update of status, assignee_id on ticketeasy.tickets
for each row execute function private.te_notif_ticket();

create function private.te_notif_mensaje() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t ticketeasy.tickets;
  para uuid[];
begin
  if new.kind = 'system' then return null; end if;   -- los cambios de estado ya avisan por el trigger del ticket
  select * into t from ticketeasy.tickets where id = new.ticket_id;
  para := case new.kind when 'reply' then array[t.requester_id, t.assignee_id] else array[t.assignee_id] end;
  if t.assignee_id is null and new.author_role = 'requester' then
    para := para || private.te_equipo_que_cubre(t.workspace_id, t.category_id);
  end if;
  perform private.te_notificar(t, 'message', para, jsonb_build_object('message_kind', new.kind));
  return null;
end $$;

create trigger te_notif_mensaje after insert on ticketeasy.ticket_messages
for each row execute function private.te_notif_mensaje();

revoke execute on function private.te_equipo_que_cubre(uuid, uuid), private.te_notificar(ticketeasy.tickets, text, uuid[], jsonb),
  private.te_notif_ticket(), private.te_notif_mensaje() from public, anon;

alter publication supabase_realtime add table ticketeasy.notifications;
