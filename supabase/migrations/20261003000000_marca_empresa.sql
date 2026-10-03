-- Marca de la empresa (núcleo Nexus): logo y paleta que comparten todas las apps de la empresa.
-- marca: { "logo_url": "https://…", "primario": "#rrggbb", "oscuro": "#rrggbb" }. Lo que falta usa la marca Fractional IT (tokens.css).
--   primario  acento: botones, enlaces, foco
--   oscuro    barra lateral y bloques de tinta
alter table public.empresas add column marca jsonb not null default '{}' check (
  jsonb_typeof(marca) = 'object'
  and coalesce(marca->>'primario', '#000000') ~* '^#[0-9a-f]{6}$'
  and coalesce(marca->>'oscuro', '#000000') ~* '^#[0-9a-f]{6}$'
  and coalesce(marca->>'logo_url', 'https://x') ~ '^https://\S+$'
  and char_length(marca::text) <= 2000);

-- La RLS de empresas solo deja escribir al admin de la plataforma; el admin de la empresa cambia solo su marca por aquí
create function public.actualizar_marca(p_empresa uuid, p_marca jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if private.rol_en_empresa(p_empresa) is distinct from 'admin' then
    raise exception 'Solo el admin de la empresa puede cambiar su marca' using errcode = '42501';
  end if;
  update public.empresas set marca = jsonb_strip_nulls(p_marca) where id = p_empresa;
end $$;

revoke execute on function public.actualizar_marca(uuid, jsonb) from public, anon;
grant execute on function public.actualizar_marca(uuid, jsonb) to authenticated;

-- my_companies ahora devuelve también la marca
drop function ticketeasy.my_companies();
create function ticketeasy.my_companies() returns table (company_id uuid, name text, role text, access text, brand jsonb)
language sql stable set search_path = '' as $$
  select m.empresa_id, e.nombre_comercial, m.rol, private.te_acceso(m.empresa_id), e.marca
  from public.empresa_miembros m join public.empresas e on e.id = m.empresa_id
  where m.usuario_id = (select auth.uid()) and m.estado = 'activo'
  order by e.nombre_comercial
$$;
revoke execute on function ticketeasy.my_companies() from public, anon;
grant execute on function ticketeasy.my_companies() to authenticated;
