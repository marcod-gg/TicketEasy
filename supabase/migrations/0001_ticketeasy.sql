-- TicketEasy · esquema inicial.
-- Multi-organización: todo cuelga de organizaciones y RLS filtra por ticketeasy.miembros.
-- Solo referencia auth.users: no depende de ninguna tabla de Nexus (public.*).
-- Después de aplicarla: Supabase → Settings → API → Exposed schemas → agregar "ticketeasy".
--
-- Alta de una organización (por ahora a mano, con el UUID de Authentication → Users):
--   insert into ticketeasy.organizaciones (nombre) values ('Fractional IT') returning id;
--   insert into ticketeasy.miembros (organizacion_id, usuario_id, nombre, rol) values ('<org>', '<usuario>', 'Marco González', 'admin');
--   insert into ticketeasy.areas (organizacion_id, nombre) values ('<org>', 'Soporte'), ('<org>', 'SAP Business One');

create schema if not exists ticketeasy;

-- ── Tablas ──────────────────────────────────────────────────────────────

create table ticketeasy.organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 2 and 120),
  creado_en timestamptz not null default now()
);

-- Nombre guardado aquí porque auth.users no se puede leer desde el navegador
create table ticketeasy.miembros (
  organizacion_id uuid not null references ticketeasy.organizaciones on delete cascade,
  usuario_id uuid not null references auth.users on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 2 and 120),
  rol text not null default 'solicitante' check (rol in ('solicitante', 'agente', 'supervisor', 'admin')),
  creado_en timestamptz not null default now(),
  primary key (organizacion_id, usuario_id)
);
create index on ticketeasy.miembros (usuario_id);

create table ticketeasy.areas (
  id uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references ticketeasy.organizaciones on delete cascade,
  nombre text not null check (length(btrim(nombre)) between 2 and 80),
  activa boolean not null default true,
  unique (organizacion_id, nombre),
  unique (organizacion_id, id)
);

-- Ciclo de vida: ver diagramas/ticketera.lifecycle.json del Portal
-- Las FK compuestas garantizan que área, solicitante y agente sean de la misma organización
create table ticketeasy.tickets (
  id bigint generated always as identity primary key,
  organizacion_id uuid not null references ticketeasy.organizaciones on delete cascade,
  area_id uuid,
  solicitante_id uuid not null default auth.uid(),
  agente_id uuid,
  asunto text not null check (length(btrim(asunto)) between 3 and 200),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 5000),
  prioridad text not null default 'media' check (prioridad in ('baja', 'media', 'alta', 'urgente')),
  estado text not null default 'nuevo' check (estado in ('nuevo', 'clasificado', 'en_curso', 'en_pausa', 'resuelto', 'reabierto', 'escalado', 'cerrado')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  foreign key (organizacion_id, area_id) references ticketeasy.areas (organizacion_id, id),
  constraint tickets_solicitante_fk foreign key (organizacion_id, solicitante_id) references ticketeasy.miembros (organizacion_id, usuario_id),
  constraint tickets_agente_fk foreign key (organizacion_id, agente_id) references ticketeasy.miembros (organizacion_id, usuario_id)
);
create index on ticketeasy.tickets (organizacion_id, actualizado_en desc);
create index on ticketeasy.tickets (solicitante_id);

-- Bitácora del ticket. Sin update ni delete: es el registro de lo que pasó
create table ticketeasy.seguimientos (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references ticketeasy.tickets on delete cascade,
  autor_id uuid default auth.uid() references auth.users on delete set null,
  tipo text not null default 'comentario' check (tipo in ('comentario', 'nota_interna', 'cambio_estado')),
  texto text not null check (length(btrim(texto)) between 1 and 5000),
  creado_en timestamptz not null default now()
);
create index on ticketeasy.seguimientos (ticket_id, creado_en);

-- ── Reglas ──────────────────────────────────────────────────────────────

-- security definer: RLS de miembros no puede consultarse a sí misma
create function ticketeasy.mi_rol(org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select rol from ticketeasy.miembros where organizacion_id = org and usuario_id = (select auth.uid())
$$;

create function ticketeasy.es_equipo(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(ticketeasy.mi_rol(org) in ('agente', 'supervisor', 'admin'), false)
$$;

-- Mismo mapa que PASOS en wwwroot/js/app.js
create function ticketeasy.transicion_valida(de text, a text) returns boolean
language sql immutable set search_path = '' as $$
  select (de, a) in (
    ('nuevo', 'clasificado'),
    ('clasificado', 'en_curso'),
    ('en_curso', 'en_pausa'), ('en_curso', 'resuelto'), ('en_curso', 'escalado'),
    ('en_pausa', 'en_curso'), ('en_pausa', 'escalado'),
    ('resuelto', 'cerrado'), ('resuelto', 'reabierto'),
    ('reabierto', 'en_curso'),
    ('escalado', 'clasificado'))
$$;

-- Valida la transición, toma el ticket al empezar a atenderlo y deja el cambio en la bitácora
create function ticketeasy.tickets_al_actualizar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.organizacion_id <> old.organizacion_id or new.solicitante_id <> old.solicitante_id or new.creado_en <> old.creado_en then
    raise exception 'No se puede cambiar la organización, el solicitante ni la fecha de creación de un ticket';
  end if;
  if new.estado <> old.estado then
    if not ticketeasy.transicion_valida(old.estado, new.estado) then
      raise exception 'Un ticket no puede pasar de % a %', old.estado, new.estado using errcode = 'check_violation';
    end if;
    if new.estado = 'en_curso' and new.agente_id is null then
      new.agente_id := auth.uid();
    end if;
    insert into ticketeasy.seguimientos (ticket_id, tipo, texto) values (new.id, 'cambio_estado', old.estado || ' → ' || new.estado);
  end if;
  new.actualizado_en := now();
  return new;
end $$;

create trigger tickets_al_actualizar before update on ticketeasy.tickets
for each row execute function ticketeasy.tickets_al_actualizar();

-- El solicitante no edita su ticket: solo confirma o rechaza la solución. Rechazar exige decir qué falta
create function ticketeasy.responder_solucion(p_ticket bigint, p_conforme boolean, p_comentario text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not p_conforme and coalesce(btrim(p_comentario), '') = '' then
    raise exception 'Cuéntanos qué sigue sin funcionar';
  end if;
  update ticketeasy.tickets set estado = case when p_conforme then 'cerrado' else 'reabierto' end
  where id = p_ticket and solicitante_id = auth.uid() and estado = 'resuelto';
  if not found then
    raise exception 'Este ticket no está esperando tu confirmación';
  end if;
  if coalesce(btrim(p_comentario), '') <> '' then
    insert into ticketeasy.seguimientos (ticket_id, tipo, texto) values (p_ticket, 'comentario', btrim(p_comentario));
  end if;
end $$;

-- ── Seguridad (RLS) ─────────────────────────────────────────────────────
-- Equipo (agente, supervisor, admin): ve y gestiona todos los tickets de su organización.
-- Solicitante: crea tickets, ve los suyos y comenta; nunca ve notas internas.

alter table ticketeasy.organizaciones enable row level security;
alter table ticketeasy.miembros enable row level security;
alter table ticketeasy.areas enable row level security;
alter table ticketeasy.tickets enable row level security;
alter table ticketeasy.seguimientos enable row level security;

create policy ver on ticketeasy.organizaciones for select to authenticated
  using (ticketeasy.mi_rol(id) is not null);

-- Un solicitante ve al equipo y a sí mismo, no al resto de solicitantes
create policy ver on ticketeasy.miembros for select to authenticated
  using (ticketeasy.mi_rol(organizacion_id) is not null
    and (ticketeasy.es_equipo(organizacion_id) or rol <> 'solicitante' or usuario_id = (select auth.uid())));
create policy admin on ticketeasy.miembros for all to authenticated
  using (ticketeasy.mi_rol(organizacion_id) = 'admin') with check (ticketeasy.mi_rol(organizacion_id) = 'admin');

create policy ver on ticketeasy.areas for select to authenticated
  using (ticketeasy.mi_rol(organizacion_id) is not null);
create policy admin on ticketeasy.areas for all to authenticated
  using (ticketeasy.mi_rol(organizacion_id) = 'admin') with check (ticketeasy.mi_rol(organizacion_id) = 'admin');

create policy ver on ticketeasy.tickets for select to authenticated
  using (ticketeasy.es_equipo(organizacion_id) or solicitante_id = (select auth.uid()));
-- El equipo puede abrir tickets a nombre de otro miembro (llamada, correo)
create policy crear on ticketeasy.tickets for insert to authenticated
  with check (ticketeasy.es_equipo(organizacion_id)
    or (solicitante_id = (select auth.uid()) and estado = 'nuevo' and agente_id is null and ticketeasy.mi_rol(organizacion_id) is not null));
create policy gestionar on ticketeasy.tickets for update to authenticated
  using (ticketeasy.es_equipo(organizacion_id)) with check (ticketeasy.es_equipo(organizacion_id));

create policy ver on ticketeasy.seguimientos for select to authenticated
  using (exists (select 1 from ticketeasy.tickets t where t.id = ticket_id
    and (ticketeasy.es_equipo(t.organizacion_id) or (t.solicitante_id = (select auth.uid()) and tipo <> 'nota_interna'))));
create policy escribir on ticketeasy.seguimientos for insert to authenticated
  with check (autor_id = (select auth.uid()) and exists (select 1 from ticketeasy.tickets t where t.id = ticket_id
    and ((ticketeasy.es_equipo(t.organizacion_id) and tipo in ('comentario', 'nota_interna'))
      or (t.solicitante_id = (select auth.uid()) and tipo = 'comentario'))));

-- Un schema propio no hereda los permisos que Supabase da a public: se otorgan explícitamente. anon no entra.
grant usage on schema ticketeasy to authenticated;
grant select on ticketeasy.organizaciones to authenticated;
grant select, insert, update, delete on ticketeasy.miembros, ticketeasy.areas to authenticated;
grant select, insert, update on ticketeasy.tickets to authenticated;
grant select, insert on ticketeasy.seguimientos to authenticated;
grant usage on all sequences in schema ticketeasy to authenticated;
revoke execute on all functions in schema ticketeasy from public, anon;
grant execute on function ticketeasy.mi_rol(uuid), ticketeasy.es_equipo(uuid), ticketeasy.responder_solucion(bigint, boolean, text) to authenticated;
