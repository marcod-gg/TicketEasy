-- Prueba del estado Cancelado: solo el equipo cancela, siempre con motivo, el duplicado debe ser otro ticket del mismo
-- workspace, no se cancela desde Resuelto, es final y el motivo no cambia después. Se revierte entera.
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
declare ws uuid; ws2 uuid; t1 bigint; t2 bigint; t3 bigint; otro bigint; n int; v text;
begin
  insert into ticketeasy.workspaces (company_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'TI') returning id into ws;
  insert into ticketeasy.workspaces (company_id, name) values ('00000000-0000-0000-0000-0000000000e1', 'RRHH') returning id into ws2;
  insert into ticketeasy.workspace_staff (workspace_id, user_id, role) values (ws, '00000000-0000-0000-0000-0000000000a1', 'owner'), (ws2, '00000000-0000-0000-0000-0000000000a1', 'owner');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Original', '<p>x</p>') returning id into t1;
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Repetido', '<p>x</p>') returning id into t2;
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Resuelto', '<p>x</p>') returning id into t3;
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws2, 'Otro ws', '<p>x</p>') returning id into otro;

  -- La solicitante no cancela: no es del equipo
  update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'withdrawn' where id = t2;
  get diagnostics n = row_count; assert n = 0, 'Ana canceló un ticket';

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  begin update ticketeasy.tickets set status = 'cancelled' where id = t2; raise exception 'Se canceló sin motivo';
  exception when check_violation then null; end;
  begin update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'duplicate', duplicate_of = otro where id = t2; raise exception 'Duplicado de otro workspace aceptado';
  exception when check_violation then null; end;
  begin update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'duplicate', duplicate_of = t2 where id = t2; raise exception 'Duplicado de sí mismo aceptado';
  exception when check_violation then null; end;
  update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'duplicate', duplicate_of = t1 where id = t2;
  select status || ':' || (cancelled_at is not null) into v from ticketeasy.tickets where id = t2;
  assert v = 'cancelled:true', v;
  select count(*) into n from ticketeasy.ticket_messages where ticket_id = t2 and kind = 'system' and body = 'new → cancelled';
  assert n = 1, 'Falta el mensaje de sistema';

  -- Final: no vuelve a abrirse ni cambia el motivo
  begin update ticketeasy.tickets set status = 'triaged' where id = t2; raise exception 'Un cancelado volvió a abrirse';
  exception when check_violation then null; end;
  begin update ticketeasy.tickets set cancel_reason = 'other', duplicate_of = null where id = t2; raise exception 'Se cambió el motivo después';
  exception when check_violation then null; end;

  -- Desde Resuelto no se cancela
  update ticketeasy.tickets set status = 'triaged' where id = t3;
  update ticketeasy.tickets set status = 'in_progress' where id = t3;
  update ticketeasy.tickets set status = 'resolved' where id = t3;
  begin update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'other' where id = t3; raise exception 'Se canceló un resuelto';
  exception when check_violation then null; end;

  -- La solicitante recibe la notificación de la cancelación
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
  select count(*) into n from ticketeasy.notifications where ticket_id = t2 and kind = 'status' and data->>'to' = 'cancelled';
  assert n = 1, 'Ana no recibió el aviso';
  raise notice 'Cancelado — OK';
end $$;

rollback;
