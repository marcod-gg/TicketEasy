-- Prueba del reloj del SLA: minutos hábiles con horario de lunes a viernes 09–18, fin de semana y feriado.
-- Corre como postgres; se revierte entera.
begin;

insert into public.empresas (id, nombre_comercial) values ('00000000-0000-0000-0000-0000000000e1', 'Empresa de prueba');
insert into ticketeasy.workspaces (id, company_id, name, holidays_enabled) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'TI', true);
insert into ticketeasy.company_settings values ('00000000-0000-0000-0000-0000000000e1', 'America/Santiago');
insert into ticketeasy.company_hours (company_id, weekday, starts, ends) select '00000000-0000-0000-0000-0000000000e1', d, '09:00', '18:00' from generate_series(1, 5) d;

do $$
declare
  ws uuid := '00000000-0000-0000-0000-0000000000f1';
  n numeric;
begin
  -- 5 de octubre de 2026 es lunes
  n := private.te_minutos_habiles(ws, null, (date '2026-10-05' + time '17:00') at time zone 'America/Santiago', (date '2026-10-06' + time '10:00') at time zone 'America/Santiago');
  assert n = 120, format('lunes 17:00 a martes 10:00: %s', n);
  n := private.te_minutos_habiles(ws, null, (date '2026-10-09' + time '17:00') at time zone 'America/Santiago', (date '2026-10-12' + time '10:00') at time zone 'America/Santiago');
  assert n = 120, format('viernes 17:00 a lunes 10:00: %s', n);
  n := private.te_minutos_habiles(ws, null, (date '2026-10-10' + time '00:00') at time zone 'America/Santiago', (date '2026-10-11' + time '23:00') at time zone 'America/Santiago');
  assert n = 0, format('fin de semana: %s', n);

  -- Feriado el martes: no cuenta
  insert into ticketeasy.holidays (company_id, day, name) values ('00000000-0000-0000-0000-0000000000e1', date '2026-10-06', 'Feriado');
  n := private.te_minutos_habiles(ws, null, (date '2026-10-05' + time '17:00') at time zone 'America/Santiago', (date '2026-10-07' + time '10:00') at time zone 'America/Santiago');
  assert n = 120, format('con feriado el martes: %s', n);

end $$;

rollback;
