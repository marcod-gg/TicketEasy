-- Prueba de turnos y asignación automática: en turno gana el de menos carga, el inactivo no recibe, el solicitante no elige
-- al asignado, fuera de horario gana el que entra antes, en feriado solo cuenta la guardia, sin nadie activo queda sin
-- asignar, y solo el admin de la empresa y quien administra el workspace configuran horarios y guardias. Se revierte entera.
begin;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'admin@prueba.test'), ('00000000-0000-0000-0000-0000000000a2', 'ag2@prueba.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'ag3@prueba.test'), ('00000000-0000-0000-0000-0000000000b1', 'ana@prueba.test');
insert into public.usuarios (id, nombre) values ('00000000-0000-0000-0000-0000000000a1', 'Admin'), ('00000000-0000-0000-0000-0000000000a2', 'Ag2'),
  ('00000000-0000-0000-0000-0000000000a3', 'Ag3'), ('00000000-0000-0000-0000-0000000000b1', 'Ana');
insert into public.empresas (id, nombre_comercial) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa de prueba');
insert into public.empresa_miembros (empresa_id, usuario_id, rol) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'admin'), ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a2', 'usuario'),
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a3', 'usuario'), ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'usuario');
insert into public.productos (id, nombre, precio_base, app, limites) values ('00000000-0000-0000-0000-0000000000d1', 'TE (prueba)', 10000, 'ticketeasy', '{"agentes": 5}');
insert into public.suscripciones (id, empresa_id, producto_id, precio_acordado, fecha_inicio, proximo_cobro) values
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 10000, current_date, current_date + 30);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);

do $$
declare ws uuid; t bigint; v uuid;
  e uuid := '00000000-0000-0000-0000-0000000000e1';
  a1 uuid := '00000000-0000-0000-0000-0000000000a1'; a2 uuid := '00000000-0000-0000-0000-0000000000a2'; a3 uuid := '00000000-0000-0000-0000-0000000000a3';
  ana text := '{"sub":"00000000-0000-0000-0000-0000000000b1"}'; adm text := '{"sub":"00000000-0000-0000-0000-0000000000a1"}';
  manana date := (now() at time zone 'America/Santiago')::date + 1;
  todo jsonb := (select jsonb_agg(jsonb_build_object('weekday', d, 'starts', '00:00', 'ends', '23:59')) from generate_series(1, 7) d);
begin
  insert into ticketeasy.workspaces (company_id, name) values (e, 'TI') returning id into ws;
  -- a1: owner que también atiende; a2 y a3: agentes; a3 inactivo (vacaciones)
  insert into ticketeasy.workspace_staff (workspace_id, user_id, role, attends) values (ws, a1, 'owner', true), (ws, a2, 'agent', true), (ws, a3, 'agent', true);
  update ticketeasy.workspace_staff set active = false where user_id = a3;
  perform ticketeasy.update_service_settings(ws, false, 48, false, true, true);

  -- Todos en turno: el de menos carga; el inactivo no recibe; el solicitante no elige al asignado
  perform ticketeasy.set_company_hours(e, 'America/Santiago', todo);
  perform set_config('request.jwt.claims', ana, true);
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Uno', '<p>x</p>') returning id into t;
  select assignee_id into v from ticketeasy.tickets where id = t; assert v = a1, format('t1 a %s', v);
  insert into ticketeasy.tickets (workspace_id, subject, description, assignee_id) values (ws, 'Dos', '<p>x</p>', a3) returning id into t;
  select assignee_id into v from ticketeasy.tickets where id = t; assert v = a2, format('t2 a %s (el solicitante no elige)', v);

  -- Fuera de horario: la empresa atiende solo mañana; a2 tiene horario propio pasado mañana → entra antes a1
  perform set_config('request.jwt.claims', adm, true);
  perform ticketeasy.set_company_hours(e, 'America/Santiago', jsonb_build_array(jsonb_build_object('weekday', extract(isodow from manana), 'starts', '09:00', 'ends', '10:00')));
  perform ticketeasy.set_staff_hours(ws, a2, jsonb_build_array(jsonb_build_object('weekday', extract(isodow from manana + 1), 'starts', '09:00', 'ends', '10:00')));
  perform set_config('request.jwt.claims', ana, true);
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Tres', '<p>x</p>') returning id into t;
  select assignee_id into v from ticketeasy.tickets where id = t; assert v = a1, format('t3 a %s (debía entrar antes a1)', v);

  -- Mañana es feriado: a1 no entra; a2 tiene guardia mañana → recibe a2
  perform set_config('request.jwt.claims', adm, true);
  insert into ticketeasy.holidays (company_id, day, name) values (e, manana, 'Feriado de prueba');
  insert into ticketeasy.staff_guards (workspace_id, user_id, day, starts, ends, note) values (ws, a2, manana, '08:00', '09:00', 'Guardia');
  perform set_config('request.jwt.claims', ana, true);
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Cuatro', '<p>x</p>') returning id into t;
  select assignee_id into v from ticketeasy.tickets where id = t; assert v = a2, format('t4 a %s (debía ir a la guardia)', v);

  -- Nadie activo: queda sin asignar
  perform set_config('request.jwt.claims', adm, true);
  update ticketeasy.workspace_staff set active = false where workspace_id = ws;
  perform set_config('request.jwt.claims', ana, true);
  insert into ticketeasy.tickets (workspace_id, subject, description) values (ws, 'Cinco', '<p>x</p>') returning id into t;
  select assignee_id into v from ticketeasy.tickets where id = t; assert v is null, 'Se asignó sin nadie activo';

  -- Permisos y validaciones
  begin perform ticketeasy.set_company_hours(e, 'America/Santiago', '[]'); raise exception 'Ana cambió el horario';
  exception when insufficient_privilege then null; end;
  begin insert into ticketeasy.staff_guards (workspace_id, user_id, day, starts, ends) values (ws, a1, manana, '08:00', '09:00'); raise exception 'Ana creó una guardia';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims', adm, true);
  begin perform ticketeasy.set_company_hours(e, 'America/Santiago', '[{"weekday":1,"starts":"09:00","ends":"13:00"},{"weekday":1,"starts":"12:00","ends":"18:00"}]');
    raise exception 'Aceptó rangos superpuestos';
  exception when check_violation then null; end;
  raise notice 'Turnos y asignación automática — OK';
end $$;

rollback;
