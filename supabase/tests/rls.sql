-- Prueba de humo de TicketEasy: acceso por plan, cupo de agentes, herencia por categorías, listas de acceso,
-- ciclo de vida, notas internas y gracia de solo lectura. Correr en Supabase → SQL Editor (o por el MCP).
-- Todo va en una transacción que se revierte: no deja datos. Si algo falla, se detiene con el motivo.
begin;

-- Empresa con plan Básica (2 agentes). a1 = admin de la empresa y owner, a2 = agente de Apps,
-- b1 = Ana (solicitante), b2 = Beto (en el grupo Ventas, bloqueado), c1 = Carla (no cabe en el plan)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'agente@prueba.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ana@prueba.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'beto@prueba.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'carla@prueba.test');
insert into public.usuarios (id, nombre) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin'), ('00000000-0000-0000-0000-0000000000a2', 'Agente'),
  ('00000000-0000-0000-0000-0000000000b1', 'Ana'), ('00000000-0000-0000-0000-0000000000b2', 'Beto'),
  ('00000000-0000-0000-0000-0000000000c1', 'Carla');
insert into public.empresas (id, nombre_comercial) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa de prueba');
insert into public.empresa_miembros (empresa_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'usuario'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'usuario'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'usuario'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'usuario');
insert into public.grupos (id, empresa_id, nombre) values ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000e1', 'Ventas');
insert into public.grupo_miembros (grupo_id, usuario_id) values ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000b2');
insert into public.productos (id, nombre, precio_base, app, limites) values
  ('00000000-0000-0000-0000-0000000000d1', 'TicketEasy Básica (prueba)', 10000, 'ticketeasy', '{"agentes": 2}');
insert into public.suscripciones (id, empresa_id, producto_id, precio_acordado, fecha_inicio, proximo_cobro) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 10000, current_date, current_date + 30);

set local role authenticated;

-- El admin arma el workspace TI: árbol Desarrollo / Apps / App-A, equipo y lista negra
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
do $$
declare
  ws uuid; dev uuid; apps uuid; appa uuid;
begin
  insert into ticketeasy.workspaces (company_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'TI') returning id into ws;
  insert into ticketeasy.workspace_staff (workspace_id, user_id, role) values (ws, '00000000-0000-0000-0000-0000000000a1', 'owner');
  insert into ticketeasy.categories (workspace_id, name) values (ws, 'Desarrollo') returning id into dev;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ws, dev, 'Apps') returning id into apps;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ws, apps, 'App-A') returning id into appa;
  assert (select path from ticketeasy.categories where id = appa) = array[dev, apps, appa], 'La ruta de App-A no es Desarrollo/Apps/App-A';

  insert into ticketeasy.workspace_staff (workspace_id, category_id, user_id, role) values (ws, apps, '00000000-0000-0000-0000-0000000000a2', 'agent');
  begin
    insert into ticketeasy.workspace_staff (workspace_id, user_id, role) values (ws, '00000000-0000-0000-0000-0000000000c1', 'agent');
    raise exception 'Se aceptó un tercer agente en un plan de 2';
  exception when check_violation then null;
  end;

  insert into ticketeasy.workspace_access (workspace_id, group_id, kind) values (ws, '00000000-0000-0000-0000-0000000000c9', 'deny');
  perform set_config('prueba.ws', ws::text, true);
  perform set_config('prueba.appa', appa::text, true);
end $$;

do $$
declare
  ws uuid := current_setting('prueba.ws')::uuid;
  appa uuid := current_setting('prueba.appa')::uuid;
  ana text := '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
  agente text := '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
  tid bigint;
  n int;
  v text;
begin
  -- Beto está en Ventas, que tiene deny: no ve el workspace
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  select count(*) into n from ticketeasy.workspaces;
  assert n = 0, 'Beto ve un workspace del que su grupo está bloqueado';

  -- Ana lo ve (workspace abierto) y abre un ticket en App-A
  perform set_config('request.jwt.claims', ana, true);
  select count(*) into n from ticketeasy.workspaces;
  assert n = 1, 'Ana no ve el workspace abierto';
  insert into ticketeasy.tickets (workspace_id, category_id, subject, description)
  values (ws, appa, 'App-A no carga', '<p>Desde hoy en la mañana</p>') returning id into tid;
  perform set_config('prueba.ticket', tid::text, true);
  update ticketeasy.tickets set status = 'closed' where id = tid;
  get diagnostics n = row_count;
  assert n = 0, 'Ana pudo editar su ticket';

  -- El agente de Apps lo ve por herencia y lo atiende
  perform set_config('request.jwt.claims', agente, true);
  select count(*) into n from ticketeasy.tickets where id = tid;
  assert n = 1, 'El agente de Apps no ve un ticket de App-A';
  begin
    update ticketeasy.tickets set status = 'resolved' where id = tid;
    raise exception 'Se permitió new → resolved';
  exception when check_violation then null;
  end;
  update ticketeasy.tickets set status = 'triaged' where id = tid;
  update ticketeasy.tickets set status = 'in_progress' where id = tid;
  select assignee_id::text into v from ticketeasy.tickets where id = tid;
  assert v = '00000000-0000-0000-0000-0000000000a2', 'Atender no asignó el ticket al agente';
  insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (tid, 'internal_note', 'Solo para el equipo');
  insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (tid, 'reply', 'Estamos revisando');
  select author_role into v from ticketeasy.ticket_messages where ticket_id = tid and body = 'Estamos revisando';
  assert v = 'agent', format('El mensaje del agente quedó con rol %s', v);
  update ticketeasy.tickets set status = 'resolved' where id = tid;

  -- Ana: ve los cambios de estado, no la nota interna, no puede escribir notas; confirma la solución
  perform set_config('request.jwt.claims', ana, true);
  select count(*) into n from ticketeasy.ticket_messages where kind = 'internal_note';
  assert n = 0, 'Ana ve notas internas';
  select count(*) into n from ticketeasy.ticket_messages where kind = 'system';
  assert n = 3, format('Ana ve %s cambios de estado, se esperaban 3', n);
  begin
    insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (tid, 'internal_note', 'Intento');
    raise exception 'Ana escribió una nota interna';
  exception when insufficient_privilege then null;
  end;
  perform ticketeasy.respond_resolution(tid, true);
  select status into v from ticketeasy.tickets where id = tid;
  assert v = 'closed', 'Confirmar no cerró el ticket';
end $$;

-- Comunicados: el owner publica; los admitidos ven solo los vigentes; nadie más publica ni cambia el autor
do $$
declare
  ws uuid := current_setting('prueba.ws')::uuid;
  n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  insert into ticketeasy.announcements (workspace_id, message, severity) values (ws, 'Correo caído', 'danger');
  insert into ticketeasy.announcements (workspace_id, message, starts_at) values (ws, 'Mantención mañana', now() + interval '1 day');
  insert into ticketeasy.announcements (workspace_id, message, is_active) values (ws, 'Oculto', false);
  insert into ticketeasy.announcements (workspace_id, message, starts_at, ends_at) values (ws, 'Ya pasó', now() - interval '2 hours', now() - interval '1 hour');
  begin
    update ticketeasy.announcements set created_by = '00000000-0000-0000-0000-0000000000b1' where workspace_id = ws;
    raise exception 'Se pudo cambiar el autor de un comunicado';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  select count(*) into n from ticketeasy.announcements;
  assert n = 1, format('Ana ve %s comunicados, se esperaba solo el vigente', n);
  begin
    insert into ticketeasy.announcements (workspace_id, message) values (ws, 'Intento');
    raise exception 'Ana publicó un comunicado';
  exception when insufficient_privilege then null;
  end;

  -- Publican owner, supervisor de todo el workspace y admin de la empresa; un agente no
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2"}', true);
  begin
    insert into ticketeasy.announcements (workspace_id, message) values (ws, 'Intento del agente');
    raise exception 'Un agente publicó un comunicado';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  select count(*) into n from ticketeasy.announcements;
  assert n = 0, 'Beto ve comunicados de un workspace del que está bloqueado';
end $$;

-- Cobro vencido hace 3 días: gracia, solo lectura
reset role;
update public.suscripciones set proximo_cobro = current_date - 3 where id = '00000000-0000-0000-0000-0000000000d2';
set local role authenticated;
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  select count(*) into n from ticketeasy.tickets;
  assert n = 1, 'En la gracia Ana debería seguir viendo su ticket';
  begin
    insert into ticketeasy.tickets (workspace_id, subject, description) values (current_setting('prueba.ws')::uuid, 'Otro', '<p>x</p>');
    raise exception 'En la gracia se pudo crear un ticket';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Vencido hace 10 días: sin acceso
reset role;
update public.suscripciones set proximo_cobro = current_date - 10 where id = '00000000-0000-0000-0000-0000000000d2';
set local role authenticated;
do $$
declare
  n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  select count(*) into n from ticketeasy.tickets;
  assert n = 0, 'Pasada la gracia Ana todavía ve tickets';
  raise notice 'TicketEasy: acceso, cupo, herencia, listas, ciclo de vida y gracia — todo OK';
end $$;

-- Marca: solo el admin de la empresa la cambia, con colores y logo válidos; los miembros la ven
do $$
declare
  e uuid := '00000000-0000-0000-0000-0000000000e1';
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  begin
    perform public.actualizar_marca(e, '{"primario":"#1d4ed8"}');
    raise exception 'Una solicitante cambió la marca';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  begin
    perform public.actualizar_marca(e, '{"logo_url":"javascript:alert(1)"}');
    raise exception 'Se aceptó un logo que no es https';
  exception when check_violation then null;
  end;
  perform public.actualizar_marca(e, '{"primario":"#1d4ed8","oscuro":"#0b1220","logo_url":null}');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  assert (select marca from public.empresas where id = e) = '{"primario":"#1d4ed8","oscuro":"#0b1220"}', 'Ana no ve la marca guardada';
  raise notice 'Marca de la empresa — OK';
end $$;

rollback;
