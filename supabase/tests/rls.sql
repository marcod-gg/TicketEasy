-- Prueba de humo de RLS y del ciclo de vida. Correr en Supabase → SQL Editor después de aplicar la migración.
-- Todo va en una transacción que se revierte: no deja datos. Si algo falla, se detiene con el motivo.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'agente@prueba.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'ana@prueba.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'beto@prueba.test');
insert into ticketeasy.organizaciones (id, nombre) values ('00000000-0000-0000-0000-00000000000f', 'Org de prueba');
insert into ticketeasy.miembros (organizacion_id, usuario_id, nombre, rol) values
  ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a1', 'Agente', 'agente'),
  ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000b1', 'Ana', 'solicitante'),
  ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000b2', 'Beto', 'solicitante');

set local role authenticated;

-- Ana crea un ticket
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1"}', true);
with t as (insert into ticketeasy.tickets (organizacion_id, asunto, descripcion)
  values ('00000000-0000-0000-0000-00000000000f', 'No imprime', 'La impresora del piso 2') returning id)
select set_config('prueba.ticket', id::text, true) from t;

do $$
declare
  tid bigint := current_setting('prueba.ticket')::bigint;
  ana text := '{"sub":"00000000-0000-0000-0000-0000000000b1"}';
  n int;
  v text;
begin
  -- Beto no ve el ticket de Ana
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2"}', true);
  select count(*) into n from ticketeasy.tickets;
  assert n = 0, 'Beto ve el ticket de Ana';

  -- Ana no puede editar su ticket (RLS lo filtra: 0 filas)
  perform set_config('request.jwt.claims', ana, true);
  update ticketeasy.tickets set estado = 'cerrado' where id = tid;
  get diagnostics n = row_count;
  assert n = 0, 'Ana pudo editar su ticket';

  -- El agente no puede saltarse pasos
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1"}', true);
  begin
    update ticketeasy.tickets set estado = 'resuelto' where id = tid;
    raise exception 'Se permitió nuevo → resuelto';
  exception when check_violation then null;
  end;

  -- Flujo normal; "Atender" asigna al agente
  update ticketeasy.tickets set estado = 'clasificado' where id = tid;
  update ticketeasy.tickets set estado = 'en_curso' where id = tid;
  select agente_id::text into v from ticketeasy.tickets where id = tid;
  assert v = '00000000-0000-0000-0000-0000000000a1', 'Atender no asignó el ticket al agente';
  insert into ticketeasy.seguimientos (ticket_id, tipo, texto) values (tid, 'nota_interna', 'Solo para el equipo');
  update ticketeasy.tickets set estado = 'resuelto' where id = tid;

  -- Ana ve los cambios de estado pero no la nota interna, y no puede escribir notas internas
  perform set_config('request.jwt.claims', ana, true);
  select count(*) into n from ticketeasy.seguimientos where tipo = 'nota_interna';
  assert n = 0, 'Ana ve notas internas';
  select count(*) into n from ticketeasy.seguimientos where tipo = 'cambio_estado';
  assert n = 3, format('Ana ve %s cambios de estado, se esperaban 3', n);
  begin
    insert into ticketeasy.seguimientos (ticket_id, tipo, texto) values (tid, 'nota_interna', 'Intento');
    raise exception 'Ana escribió una nota interna';
  exception when insufficient_privilege then null;
  end;

  -- Ana confirma la solución
  perform ticketeasy.responder_solucion(tid, true);
  select estado into v from ticketeasy.tickets where id = tid;
  assert v = 'cerrado', 'Confirmar no cerró el ticket';

  raise notice 'RLS y ciclo de vida: todo OK';
end $$;

rollback;
