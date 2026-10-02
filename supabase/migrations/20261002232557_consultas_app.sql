-- Consultas que la app necesita y que la API no alcanza por sí sola.

-- Empresas del usuario con su acceso a TicketEasy ('completo' | 'lectura' | null).
-- security invoker: lee con la RLS de membresías y empresas del propio usuario
create function ticketeasy.my_companies() returns table (company_id uuid, name text, role text, access text)
language sql stable set search_path = '' as $$
  select m.empresa_id, e.nombre_comercial, m.rol, private.te_acceso(m.empresa_id)
  from public.empresa_miembros m join public.empresas e on e.id = m.empresa_id
  where m.usuario_id = (select auth.uid()) and m.estado = 'activo'
  order by e.nombre_comercial
$$;

-- Directorio de la empresa para elegir personas (equipo, listas de acceso, tickets a nombre de otro).
-- security definer porque la RLS de membresías solo muestra la propia; responde solo a miembros activos de esa empresa
create function ticketeasy.company_directory(p_company uuid) returns table (user_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.nombre
  from public.empresa_miembros m join public.usuarios u on u.id = m.usuario_id
  where m.empresa_id = p_company and m.estado = 'activo' and u.eliminado_en is null
    and private.rol_en_empresa(p_company) is not null
  order by u.nombre
$$;

revoke execute on function ticketeasy.my_companies(), ticketeasy.company_directory(uuid) from public, anon;
grant execute on function ticketeasy.my_companies(), ticketeasy.company_directory(uuid) to authenticated;
