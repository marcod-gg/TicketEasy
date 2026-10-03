-- Prueba de las notificaciones: quién recibe cada aviso, nadie recibe los propios, la nota interna no llega
-- al solicitante y solo se puede marcar read_at. Correr en Supabase → SQL Editor (o por el MCP). Se revierte entera.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'agente@prueba.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ana@prueba.test');
insert into public.usuarios (id, nombre) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin'), ('00000000-0000-0000-0000-0000000000a2', 'Agente'), ('00000000-0000-0000-0000-0000000000b1', 'Ana');
insert into public.empresas (id, nombre_comercial) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa de prueba');
insert into public.empresa_miembros (empresa_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'usuario'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'usuario');
insert into public.productos (id, nombre, precio_base, app, limites) values
  ('00000000-0000-0000-0000-0000000000d1', 'TicketEasy (prueba)', 10000, 'ticketeasy', '{"agentes": 5}');
insert into public.suscripciones (id, empresa_id, producto_id, precio_acordado, fecha_inicio, proximo_cobro) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 10000, current_date, current_date + 30);
set local role authenticated;

-- Workspace TI: owner = admin; agente con alcance en Apps; Redes sin agente
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
do $$
declare ws uuid; apps uuid; otra uuid;
begin
  insert into ticketeasy.workspaces (company_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'TI') returning id into ws;
  insert into ticketeasy.workspace_staff (workspace_id, user_id, role) values (ws, '00000000-0000-0000-0000-0000000000a1', 'owner');
  insert into ticketeasy.categories (workspace_id, name) values (ws, 'Apps') returning id into apps;
  insert into ticketeasy.categories (workspace_id, name) values (ws, 'Redes') returning id into otra;
  insert into ticketeasy.workspace_staff (workspace_id, category_id, user_id, role) values (ws, apps, '00000000-0000-0000-0000-0000000000a2', 'agent');
  perform set_config('prueba.ws', ws::text, true);
  perform set_config('prueba.apps', apps::text, true);
  perform set_config('prueba.otra', otra::text, true);
end $$;

do $$
declare
  ws uuid := current_setting('prueba.ws')::uuid;
  tid bigint; t2 bigint; n int;
  ana text := '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
  agente text := '{"sub":"00000000-0000-0000-0000-0000000000a2"}';
  adm text := '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
begin
  -- Ana abre en Apps: avisa a owner y agente de Apps; en Redes: solo al owner
  perform set_config('request.jwt.claims', ana, true);
  insert into ticketeasy.tickets (workspace_id, category_id, subject, description) values (ws, current_setting('prueba.apps')::uuid, 'App caída', '<p>x</p>') returning id into tid;
  insert into ticketeasy.tickets (workspace_id, category_id, subject, description) values (ws, current_setting('prueba.otra')::uuid, 'Sin wifi', '<p>x</p>') returning id into t2;
  select count(*) into n from ticketeasy.notifications; assert n = 0, 'Ana recibió aviso de su propio ticket';
  perform set_config('request.jwt.claims', agente, true);
  select count(*) into n from ticketeasy.notifications where ticket_id = tid and kind = 'new_ticket'; assert n = 1, 'El agente de Apps no recibió el ticket nuevo';
  select count(*) into n from ticketeasy.notifications where ticket_id = t2; assert n = 0, 'El agente de Apps recibió un ticket de Redes';
  perform set_config('request.jwt.claims', adm, true);
  select count(*) into n from ticketeasy.notifications where kind = 'new_ticket'; assert n = 2, format('El owner recibió %s tickets nuevos, se esperaban 2', n);

  -- El agente atiende (se autoasigna) y escribe: no se avisa a sí mismo; la nota interna no llega a Ana
  perform set_config('request.jwt.claims', agente, true);
  update ticketeasy.tickets set status = 'triaged' where id = tid;
  update ticketeasy.tickets set status = 'in_progress' where id = tid;
  insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (tid, 'internal_note', 'nota');
  insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (tid, 'reply', 'revisando');
  select count(*) into n from ticketeasy.notifications where kind <> 'new_ticket'; assert n = 0, 'El agente recibió avisos de sus propias acciones';
  perform set_config('request.jwt.claims', ana, true);
  select count(*) into n from ticketeasy.notifications where kind = 'status'; assert n = 2, format('Ana recibió %s cambios de estado, se esperaban 2', n);
  select count(*) into n from ticketeasy.notifications where kind = 'message'; assert n = 1, format('Ana recibió %s mensajes, se esperaba 1 (sin la nota interna)', n);

  -- Ana responde: le llega al asignado. Ana marca leídas y no puede tocar otra columna
  insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (tid, 'reply', 'gracias');
  update ticketeasy.notifications set read_at = now();
  select count(*) into n from ticketeasy.notifications where read_at is null; assert n = 0, 'Ana no pudo marcar leídas';
  begin
    update ticketeasy.notifications set user_id = '00000000-0000-0000-0000-0000000000a2';
    raise exception 'Ana cambió el destinatario de una notificación';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', agente, true);
  select count(*) into n from ticketeasy.notifications where kind = 'message'; assert n = 1, 'El agente no recibió la respuesta de Ana';

  -- Reasignar al owner le avisa
  update ticketeasy.tickets set assignee_id = '00000000-0000-0000-0000-0000000000a1' where id = tid;
  perform set_config('request.jwt.claims', adm, true);
  select count(*) into n from ticketeasy.notifications where kind = 'assigned'; assert n = 1, 'El owner no recibió la asignación';
  raise notice 'Notificaciones — OK';
end $$;

rollback;
