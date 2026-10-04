-- Prueba de Pendiente de respuesta, cierre automático y encuesta: ajustes solo para quien gestiona, la respuesta del
-- solicitante devuelve el ticket a En curso, recordatorio a la mitad del plazo (una vez), cancelación al vencer y
-- encuesta una vez, solo con el ticket cerrado y con etiquetas acordes a las estrellas. Se revierte entera.
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'), ('00000000-0000-0000-0000-0000000000b1', 'ana@prueba.test');
insert into public.usuarios (id, nombre) values ('00000000-0000-0000-0000-0000000000a1', 'Admin'), ('00000000-0000-0000-0000-0000000000b1', 'Ana');
insert into public.empresas (id, nombre_comercial) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa de prueba');
insert into public.empresa_miembros (empresa_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'admin'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'usuario');
insert into public.productos (id, nombre, precio_base, app, limites) values ('00000000-0000-0000-0000-0000000000d1', 'TE (prueba)', 10000, 'ticketeasy', '{"agentes": 5}');
insert into public.suscripciones (id, empresa_id, producto_id, precio_acordado, fecha_inicio, proximo_cobro) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 10000, current_date, current_date + 30);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

do $$
declare ws uuid; t1 bigint; t2 bigint; t3 bigint; n int; v text;
  adm text := '{"sub":"00000000-0000-0000-0000-0000000000a1"}'; ana text := '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
begin
  insert into ticketeasy.workspaces (company_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'TI') returning id into ws;
  insert into ticketeasy.workspace_staff (workspace_id, user_id, role) values (ws, '00000000-0000-0000-0000-0000000000a1', 'owner');

  -- Ajustes: el owner activa cierre automático (10 h) y encuesta; la solicitante no puede
  perform ticketeasy.update_service_settings(ws, true, 10, true);
  perform set_config('request.jwt.claims', ana, true);
  begin perform ticketeasy.update_service_settings(ws, false, 10, false); raise exception 'Ana cambió los ajustes';
  exception when insufficient_privilege then null; end;
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Uno', '<p>x</p>') returning id into t1;
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Dos', '<p>x</p>') returning id into t2;
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Tres', '<p>x</p>') returning id into t3;

  -- El owner pide información en los tres
  perform set_config('request.jwt.claims', adm, true);
  update ticketeasy.tickets set status = 'triaged' where id in (t1, t2, t3);
  update ticketeasy.tickets set status = 'in_progress' where id in (t1, t2, t3);
  update ticketeasy.tickets set status = 'pending_requester' where id in (t1, t2, t3);
  select count(*) into n from ticketeasy.tickets where id in (t1, t2, t3) and awaiting_since is not null;
  assert n = 3, 'Falta awaiting_since';

  -- La solicitante responde t1: vuelve a En curso
  perform set_config('request.jwt.claims', ana, true);
  insert into ticketeasy.ticket_messages (ticket_id, kind, body) values (t1, 'reply', 'Aquí va la info');
  select status into v from ticketeasy.tickets where id = t1; assert v = 'in_progress', format('t1 quedó en %s', v);
  select count(*) into n from ticketeasy.tickets where id = t1 and awaiting_since is null; assert n = 1, 'awaiting_since no se limpió';

  -- Paso del tiempo: t2 lleva 6 h (recordatorio), t3 11 h (se cancela)
  reset role;
  update ticketeasy.tickets set awaiting_since = now() - interval '6 hours' where id = t2;
  update ticketeasy.tickets set awaiting_since = now() - interval '11 hours' where id = t3;
  perform private.te_autocierre();
  select status || ':' || coalesce(cancel_reason, '-') into v from ticketeasy.tickets where id = t3; assert v = 'cancelled:no_response', v;
  select status || ':' || (reminded_at is not null) into v from ticketeasy.tickets where id = t2; assert v = 'pending_requester:true', v;
  perform private.te_autocierre();   -- no repite el recordatorio
  select count(*) into n from ticketeasy.notifications where ticket_id = t2 and kind = 'reminder'; assert n = 1, format('%s recordatorios', n);

  -- Encuesta: solo con el ticket cerrado, una vez y con etiquetas acordes
  set local role authenticated;
  perform set_config('request.jwt.claims', ana, true);
  begin insert into ticketeasy.ticket_feedback (ticket_id, rating) values (t1, 5); raise exception 'Calificó un ticket abierto';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', adm, true);
  update ticketeasy.tickets set status = 'resolved' where id = t1;
  perform set_config('request.jwt.claims', ana, true);
  perform ticketeasy.respond_resolution(t1, true, null);
  begin insert into ticketeasy.ticket_feedback (ticket_id, rating, tags) values (t1, 5, array['slow']); raise exception 'Etiqueta negativa con 5 estrellas';
  exception when check_violation then null; end;
  insert into ticketeasy.ticket_feedback (ticket_id, rating, tags, comment) values (t1, 5, array['fast', 'kind'], 'Excelente');
  begin insert into ticketeasy.ticket_feedback (ticket_id, rating) values (t1, 3); raise exception 'Calificó dos veces';
  exception when unique_violation then null; end;
  perform set_config('request.jwt.claims', adm, true);
  select count(*) into n from ticketeasy.ticket_feedback where ticket_id = t1; assert n = 1, 'El equipo no ve la encuesta';
  raise notice 'Pendiente de respuesta, cierre automático y encuesta — OK';
end $$;

rollback;
