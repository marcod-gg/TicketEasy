-- TicketEasy · esquema. App del núcleo Nexus: empresas, usuarios, membresías, grupos y suscripciones viven en public;
-- las funciones de acceso, en private (fuera de la API). Reemplaza el esquema de prueba anterior (solo tenía datos de prueba).
--
-- Quién puede qué:
--   · Acceso a la app: miembro activo de la empresa + plan de TicketEasy vigente (private.acceso_app).
--     'lectura' (gracia de 7 días) permite ver, no escribir.
--   · Admin de la empresa (empresa_miembros.rol = 'admin'): crea workspaces y nombra a su equipo.
--   · Equipo del workspace (workspace_staff), con alcance en todo el workspace o en una rama de categorías:
--       owner      administra el workspace: categorías, formularios, equipo, listas de acceso
--       supervisor ve y gestiona todos los tickets de su alcance, recibe los escalados
--       agent      atiende los tickets de su alcance
--     Cada persona distinta del equipo ocupa un cupo del plan ({"agentes": N}).
--   · Solicitante: cualquier miembro que el workspace admita (open: todos menos la lista negra;
--     restricted: solo la lista blanca). Ve sus tickets y conversa; nunca ve notas internas.
--
-- Fase 2 (diseñado, se crea cuando se use): adjuntos + bucket de Storage, horarios, feriados y SLA.

drop schema if exists ticketeasy cascade;
create schema ticketeasy;

-- ── Tablas ──────────────────────────────────────────────────────────────

create table ticketeasy.workspaces (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.empresas on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  access_mode text not null default 'open' check (access_mode in ('open', 'restricted')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, name),
  unique (company_id, id)
);

-- Árbol por workspace. path = ids desde la raíz hasta la propia categoría (lo mantiene el trigger)
create table ticketeasy.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  parent_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  path uuid[] not null default '{}',
  allow_attachments boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique nulls not distinct (workspace_id, parent_id, name),
  foreign key (workspace_id, parent_id) references ticketeasy.categories (workspace_id, id) on delete cascade
);
create index on ticketeasy.categories using gin (path);

-- category_id null = todo el workspace; con valor = esa rama con sus subcategorías. El owner siempre abarca todo
create table ticketeasy.workspace_staff (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  category_id uuid,
  user_id uuid not null references public.usuarios on delete cascade,
  role text not null check (role in ('owner', 'supervisor', 'agent')),
  created_at timestamptz not null default now(),
  check (role <> 'owner' or category_id is null),
  unique nulls not distinct (workspace_id, user_id, category_id),
  foreign key (workspace_id, category_id) references ticketeasy.categories (workspace_id, id) on delete cascade
);
create index on ticketeasy.workspace_staff (user_id);

-- Lista blanca (allow) o negra (deny), por persona o por grupo. Un deny siempre gana
create table ticketeasy.workspace_access (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  user_id uuid references public.usuarios on delete cascade,
  group_id uuid references public.grupos on delete cascade,
  kind text not null check (kind in ('allow', 'deny')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, group_id) = 1),
  unique nulls not distinct (workspace_id, user_id, group_id)
);

-- Formulario de la categoría. Al crear un ticket se usa el de la categoría más cercana hacia la raíz que tenga campos;
-- si ninguna tiene, el del sistema (asunto, descripción, tipo, prioridad)
create table ticketeasy.form_fields (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references ticketeasy.categories on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,49}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  field_type text not null check (field_type in
    ('text', 'textarea', 'rich_text', 'number', 'date', 'datetime', 'select', 'multiselect', 'checkbox', 'email', 'phone')),
  is_required boolean not null default false,
  position int not null default 0,
  help_text text check (char_length(help_text) <= 500),
  placeholder text check (char_length(placeholder) <= 200),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category_id, key)
);

-- Ciclo de vida: ver diagramas/ticketera.lifecycle.json del Portal.
-- company_id lo completa el trigger desde el workspace. Las FK compuestas exigen que workspace, categoría,
-- solicitante y asignado sean de la misma empresa.
-- description, resolution y los campos rich_text son HTML: se sanitizan al mostrarlos (DOMPurify)
-- custom_fields: [{ "key", "label", "type", "value" }] con copia de la etiqueta, para que el historial no dependa del formulario actual
create table ticketeasy.tickets (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  workspace_id uuid not null,
  category_id uuid,
  requester_id uuid not null default auth.uid(),
  assignee_id uuid,
  type text not null default 'incident' check (type in ('incident', 'request', 'question', 'problem')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'new' check (status in ('new', 'triaged', 'in_progress', 'on_hold', 'resolved', 'reopened', 'escalated', 'closed')),
  subject text not null check (char_length(btrim(subject)) between 3 and 200),
  description text not null check (char_length(description) between 1 and 50000),
  custom_fields jsonb not null default '[]' check (jsonb_typeof(custom_fields) = 'array'),
  resolution text check (char_length(resolution) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  foreign key (company_id, workspace_id) references ticketeasy.workspaces (company_id, id),
  foreign key (workspace_id, category_id) references ticketeasy.categories (workspace_id, id),
  foreign key (company_id, requester_id) references public.empresa_miembros (empresa_id, usuario_id),
  foreign key (company_id, assignee_id) references public.empresa_miembros (empresa_id, usuario_id)
);
create index on ticketeasy.tickets (workspace_id, updated_at desc);
create index on ticketeasy.tickets (requester_id);
create index on ticketeasy.tickets (assignee_id);

-- Conversación. author_role es la foto del rol al escribir (lo pone el trigger). Sin update ni delete: es el registro
create table ticketeasy.ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references ticketeasy.tickets on delete cascade,
  author_id uuid default auth.uid() references public.usuarios on delete set null,
  author_role text not null default 'requester' check (author_role in ('requester', 'agent', 'supervisor', 'owner')),
  kind text not null default 'reply' check (kind in ('reply', 'internal_note', 'system')),
  body text not null check (char_length(body) between 1 and 50000),
  created_at timestamptz not null default now()
);
create index on ticketeasy.ticket_messages (ticket_id, created_at);

-- ── Funciones de acceso (en private: la API no las expone) ──────────────

-- Acceso a la app en la empresa: 'completo' | 'lectura' | null
create function private.te_acceso(empresa uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when private.rol_en_empresa(empresa) is not null then private.acceso_app('ticketeasy', empresa) end
$$;

-- Mejor rol del usuario actual que cubre esa categoría (o todo el workspace si cat es null)
create function private.te_rol(ws uuid, cat uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.role from ticketeasy.workspace_staff s
  where s.workspace_id = ws and s.user_id = (select auth.uid())
    and (s.category_id is null or s.category_id = any (coalesce((select c.path from ticketeasy.categories c where c.id = cat), '{}')))
  order by array_position(array['owner', 'supervisor', 'agent'], s.role)
  limit 1
$$;

-- ¿Es parte del equipo del workspace, con cualquier alcance?
create function private.te_es_equipo(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from ticketeasy.workspace_staff where workspace_id = ws and user_id = (select auth.uid()))
$$;

-- ¿Puede ver y abrir tickets en el workspace? El equipo siempre; el resto según modo y listas (deny gana)
create function private.te_admitido(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with yo as (select (select auth.uid()) as id),
  mios as (select grupo_id from public.grupo_miembros, yo where usuario_id = yo.id),
  reglas as (
    select a.kind from ticketeasy.workspace_access a, yo
    where a.workspace_id = ws and (a.user_id = yo.id or a.group_id in (select grupo_id from mios)))
  select coalesce(w.is_active and private.rol_en_empresa(w.company_id) is not null and (
    private.te_es_equipo(ws) or (
      not exists (select 1 from reglas where kind = 'deny')
      and (w.access_mode = 'open' or exists (select 1 from reglas where kind = 'allow')))), false)
  from ticketeasy.workspaces w where w.id = ws
$$;

-- ¿Administra el workspace? Su owner o el admin de la empresa
create function private.te_administra(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.te_rol(ws, null) = 'owner' or private.rol_en_empresa(w.company_id) = 'admin', false)
  from ticketeasy.workspaces w where w.id = ws
$$;

create function private.te_empresa(ws uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from ticketeasy.workspaces where id = ws
$$;

-- Mismo mapa que PASOS en wwwroot/js/app.js
create function private.te_transicion_valida(de text, a text) returns boolean
language sql immutable set search_path = '' as $$
  select (de, a) in (
    ('new', 'triaged'),
    ('triaged', 'in_progress'),
    ('in_progress', 'on_hold'), ('in_progress', 'resolved'), ('in_progress', 'escalated'),
    ('on_hold', 'in_progress'), ('on_hold', 'escalated'),
    ('resolved', 'closed'), ('resolved', 'reopened'),
    ('reopened', 'in_progress'),
    ('escalated', 'triaged'))
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

-- ── Triggers ────────────────────────────────────────────────────────────

-- Ruta del árbol; si cambia el padre se actualizan las rutas de toda la rama
create function private.te_categoria_ruta() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  ruta_padre uuid[] := coalesce((select path from ticketeasy.categories where id = new.parent_id), '{}');
begin
  if new.id = any (ruta_padre) then
    raise exception 'Una categoría no puede quedar dentro de sí misma';
  end if;
  new.path := ruta_padre || new.id;
  if tg_op = 'UPDATE' and new.path <> old.path then
    update ticketeasy.categories set path = new.path || path[array_position(path, new.id) + 1:]
    where new.id = any (path) and id <> new.id;
  end if;
  return new;
end $$;

create trigger te_categoria_ruta before insert or update of parent_id on ticketeasy.categories
for each row execute function private.te_categoria_ruta();

-- El equipo debe ser miembro activo de la empresa y caber en el plan (cada persona distinta ocupa un cupo)
-- ponytail: dos altas simultáneas pueden pasar el conteo a la vez; bloquear por empresa (advisory lock) si llega a importar
create function private.te_equipo_cupo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  empresa uuid := private.te_empresa(new.workspace_id);
  limite int := private.limite_plan('ticketeasy', empresa, 'agentes');
begin
  if not exists (select 1 from public.empresa_miembros where empresa_id = empresa and usuario_id = new.user_id and estado = 'activo') then
    raise exception 'Esa persona no es miembro activo de la empresa';
  end if;
  if limite is not null and not exists (
      select 1 from ticketeasy.workspace_staff s join ticketeasy.workspaces w on w.id = s.workspace_id
      where w.company_id = empresa and s.user_id = new.user_id and s.id <> new.id)
    and (select count(distinct s.user_id) from ticketeasy.workspace_staff s join ticketeasy.workspaces w on w.id = s.workspace_id
         where w.company_id = empresa and s.id <> new.id) >= limite then
    raise exception 'Tu plan permite % agentes. Sube de plan para sumar más.', limite using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger te_equipo_cupo before insert or update of user_id, workspace_id on ticketeasy.workspace_staff
for each row execute function private.te_equipo_cupo();

-- Lista de acceso: la persona o el grupo deben ser de la empresa del workspace
create function private.te_acceso_misma_empresa() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  empresa uuid := private.te_empresa(new.workspace_id);
begin
  if new.user_id is not null and not exists (select 1 from public.empresa_miembros where empresa_id = empresa and usuario_id = new.user_id)
    or new.group_id is not null and not exists (select 1 from public.grupos where empresa_id = empresa and id = new.group_id) then
    raise exception 'La persona o el grupo no pertenecen a la empresa del workspace';
  end if;
  return new;
end $$;

create trigger te_acceso_misma_empresa before insert or update on ticketeasy.workspace_access
for each row execute function private.te_acceso_misma_empresa();

create function private.te_ticket_al_crear() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.company_id := private.te_empresa(new.workspace_id);
  return new;
end $$;

create trigger te_ticket_al_crear before insert on ticketeasy.tickets
for each row execute function private.te_ticket_al_crear();

-- Valida la transición, toma el ticket al atenderlo, marca fechas y deja el cambio en la conversación
create function private.te_ticket_al_actualizar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.company_id <> old.company_id or new.workspace_id <> old.workspace_id or new.requester_id <> old.requester_id or new.created_at <> old.created_at then
    raise exception 'No se puede cambiar la empresa, el workspace, el solicitante ni la fecha de creación de un ticket';
  end if;
  if new.status <> old.status then
    if not private.te_transicion_valida(old.status, new.status) then
      raise exception 'Un ticket no puede pasar de % a %', old.status, new.status using errcode = 'check_violation';
    end if;
    if new.status = 'in_progress' and new.assignee_id is null then
      new.assignee_id := auth.uid();
    end if;
    new.resolved_at := case new.status when 'resolved' then now() when 'reopened' then null else old.resolved_at end;
    if new.status = 'closed' then new.closed_at := now(); end if;
    insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (new.id, 'system', old.status || ' → ' || new.status);
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger te_ticket_al_actualizar before update on ticketeasy.tickets
for each row execute function private.te_ticket_al_actualizar();

-- Foto del rol del autor y "último movimiento" del ticket
create function private.te_mensaje_al_crear() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t ticketeasy.tickets;
begin
  select * into t from ticketeasy.tickets where id = new.ticket_id;
  new.author_role := coalesce(private.te_rol(t.workspace_id, t.category_id), 'requester');
  if new.kind <> 'system' then
    update ticketeasy.tickets set updated_at = now() where id = new.ticket_id;
  end if;
  return new;
end $$;

create trigger te_mensaje_al_crear before insert on ticketeasy.ticket_messages
for each row execute function private.te_mensaje_al_crear();

-- El solicitante no edita su ticket: confirma o rechaza la solución. Rechazar exige decir qué falta.
-- Está en ticketeasy (no en private) porque la app la llama por RPC
create function ticketeasy.respond_resolution(p_ticket bigint, p_accepted boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t ticketeasy.tickets;
begin
  select * into t from ticketeasy.tickets where id = p_ticket and requester_id = (select auth.uid()) and status = 'resolved';
  if not found then
    raise exception 'Este ticket no está esperando tu confirmación';
  end if;
  if private.te_acceso(t.company_id) is distinct from 'completo' then
    raise exception 'El plan de TicketEasy de tu empresa no está vigente';
  end if;
  if not p_accepted and coalesce(btrim(p_comment), '') = '' then
    raise exception 'Cuéntanos qué sigue sin funcionar';
  end if;
  update ticketeasy.tickets set status = case when p_accepted then 'closed' else 'reopened' end where id = p_ticket;
  if coalesce(btrim(p_comment), '') <> '' then
    insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (p_ticket, 'reply', btrim(p_comment));
  end if;
end $$;

-- ── Seguridad (RLS) ─────────────────────────────────────────────────────
-- Leer exige acceso ('completo' o 'lectura'); escribir exige 'completo'.

alter table ticketeasy.workspaces enable row level security;
alter table ticketeasy.categories enable row level security;
alter table ticketeasy.workspace_staff enable row level security;
alter table ticketeasy.workspace_access enable row level security;
alter table ticketeasy.form_fields enable row level security;
alter table ticketeasy.tickets enable row level security;
alter table ticketeasy.ticket_messages enable row level security;

create policy ver on ticketeasy.workspaces for select to authenticated
  using (private.te_acceso(company_id) is not null and (private.te_admitido(id) or private.rol_en_empresa(company_id) = 'admin'));
create policy crear on ticketeasy.workspaces for insert to authenticated
  with check (private.rol_en_empresa(company_id) = 'admin' and private.te_acceso(company_id) = 'completo');
create policy administrar on ticketeasy.workspaces for update to authenticated
  using (private.te_administra(id) and private.te_acceso(company_id) = 'completo')
  with check (private.te_administra(id));

create policy ver on ticketeasy.categories for select to authenticated
  using (private.te_acceso(private.te_empresa(workspace_id)) is not null and (private.te_admitido(workspace_id) or private.te_administra(workspace_id)));
create policy administrar on ticketeasy.categories for all to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo')
  with check (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');

create policy ver on ticketeasy.form_fields for select to authenticated
  using (exists (select 1 from ticketeasy.categories c where c.id = category_id));
create policy administrar on ticketeasy.form_fields for all to authenticated
  using (exists (select 1 from ticketeasy.categories c where c.id = category_id
    and private.te_administra(c.workspace_id) and private.te_acceso(private.te_empresa(c.workspace_id)) = 'completo'))
  with check (exists (select 1 from ticketeasy.categories c where c.id = category_id
    and private.te_administra(c.workspace_id) and private.te_acceso(private.te_empresa(c.workspace_id)) = 'completo'));

-- El equipo se ve entre sí (asignar, reasignar); quien administra lo gestiona
create policy ver on ticketeasy.workspace_staff for select to authenticated
  using (private.te_es_equipo(workspace_id) or private.te_administra(workspace_id));
create policy administrar on ticketeasy.workspace_staff for all to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo')
  with check (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');

create policy ver on ticketeasy.workspace_access for select to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) is not null);
create policy administrar on ticketeasy.workspace_access for all to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo')
  with check (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');

create policy ver on ticketeasy.tickets for select to authenticated
  using (private.te_acceso(company_id) is not null
    and (requester_id = (select auth.uid()) or private.te_rol(workspace_id, category_id) is not null));
-- El solicitante abre tickets nuevos a su nombre; el equipo puede abrirlos a nombre de otro miembro (llamada, correo)
create policy crear on ticketeasy.tickets for insert to authenticated
  with check (private.te_acceso(private.te_empresa(workspace_id)) = 'completo' and (
    private.te_rol(workspace_id, category_id) is not null
    or (requester_id = (select auth.uid()) and status = 'new' and assignee_id is null and private.te_admitido(workspace_id))));
-- Solo el equipo con alcance sobre la categoría; al moverlo de categoría, la nueva también debe estar en su alcance
create policy gestionar on ticketeasy.tickets for update to authenticated
  using (private.te_acceso(company_id) = 'completo' and private.te_rol(workspace_id, category_id) is not null)
  with check (private.te_rol(workspace_id, category_id) is not null);

-- La subconsulta aplica la RLS de tickets: si ves el ticket, ves sus mensajes, salvo las notas internas si no eres del equipo
create policy ver on ticketeasy.ticket_messages for select to authenticated
  using (exists (select 1 from ticketeasy.tickets t where t.id = ticket_id
    and (kind <> 'internal_note' or private.te_rol(t.workspace_id, t.category_id) is not null)));
create policy escribir on ticketeasy.ticket_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (select 1 from ticketeasy.tickets t where t.id = ticket_id
    and private.te_acceso(t.company_id) = 'completo'
    and ((private.te_rol(t.workspace_id, t.category_id) is not null and kind in ('reply', 'internal_note'))
      or (t.requester_id = (select auth.uid()) and kind = 'reply'))));

-- Un schema propio no hereda los permisos que Supabase da a public: se otorgan explícitamente. anon no entra
grant usage on schema ticketeasy to authenticated;
grant select, insert, update on ticketeasy.workspaces, ticketeasy.tickets to authenticated;
grant select, insert, update, delete on ticketeasy.categories, ticketeasy.workspace_staff, ticketeasy.workspace_access, ticketeasy.form_fields to authenticated;
grant select, insert on ticketeasy.ticket_messages to authenticated;
revoke execute on function ticketeasy.respond_resolution(bigint, boolean, text) from public, anon;
grant execute on function ticketeasy.respond_resolution(bigint, boolean, text) to authenticated;
