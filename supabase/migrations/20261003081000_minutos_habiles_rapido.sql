-- Minutos hábiles más rápidos: carga una vez la semana, las guardias y los feriados del rango y recorre los días en memoria
-- (antes consultaba te_rangos_del_dia por cada día: ~10 s para 70 tickets en Análisis de datos). Misma regla de turno.
create or replace function private.te_minutos_habiles(ws uuid, uid uuid, a timestamptz, b timestamptz) returns numeric
language plpgsql stable security definer set search_path = '' as $$
declare
  tz text := private.te_zona(ws);
  la timestamp := a at time zone tz;
  lb timestamp := b at time zone tz;
  empresa uuid := private.te_empresa(ws);
  con_feriados boolean := (select holidays_enabled from ticketeasy.workspaces where id = ws);
  semana jsonb;
  guardias jsonb;
  feriados date[];
  d date;
  r jsonb;
  ini timestamp;
  fin timestamp;
  total numeric := 0;
begin
  if b <= a then return 0; end if;
  -- Semana: la propia; si no hay, la de la empresa; si tampoco, todo el día (como te_rangos_del_dia)
  semana := (select jsonb_agg(jsonb_build_object('w', weekday, 's', starts, 'e', ends)) from ticketeasy.staff_hours where workspace_id = ws and user_id = uid);
  if semana is null then
    semana := (select jsonb_agg(jsonb_build_object('w', weekday, 's', starts, 'e', ends)) from ticketeasy.company_hours where company_id = empresa);
  end if;
  if semana is null then
    semana := (select jsonb_agg(jsonb_build_object('w', w, 's', '00:00', 'e', '23:59:59.999999')) from generate_series(1, 7) w);
  end if;
  guardias := coalesce((select jsonb_agg(jsonb_build_object('d', day, 's', starts, 'e', ends)) from ticketeasy.staff_guards
    where workspace_id = ws and user_id = uid and day between la::date and lb::date), '[]');
  feriados := case when con_feriados then (select array_agg(day) from ticketeasy.holidays
    where company_id = empresa and (workspace_id is null or workspace_id = ws) and day between la::date and lb::date) end;
  d := la::date;
  while d <= lb::date loop
    for r in
      select g from jsonb_array_elements(guardias) g where (g->>'d')::date = d
      union all
      select s from jsonb_array_elements(semana) s
      where (s->>'w')::int = extract(isodow from d) and not (d = any (coalesce(feriados, '{}')))
    loop
      ini := greatest(d + (r->>'s')::time, la);
      fin := least(d + (r->>'e')::time, lb);
      if fin > ini then total := total + extract(epoch from fin - ini) / 60; end if;
    end loop;
    d := d + 1;
  end loop;
  return total;
end $$;
