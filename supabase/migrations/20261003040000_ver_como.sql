-- "Ver como" (Gestión): quien publica en el workspace (owner, supervisor de todo el workspace o admin de la empresa)
-- ve los tickets del workspace tal como los ve otra persona de la empresa. Solo lectura: no hay sesión suplantada,
-- es una consulta que replica la RLS de tickets para p_user y se revalida en cada llamada.
-- El owner y el supervisor de todo el workspace ya ven todos esos tickets; el admin de la empresa los ve por aquí
-- aunque no sea del equipo (igual puede sumarse como owner).
create function ticketeasy.tickets_como(p_ws uuid, p_user uuid) returns setof ticketeasy.tickets
language sql stable security definer set search_path = '' as $$
  select t.* from ticketeasy.tickets t
  where t.workspace_id = p_ws
    and private.te_publica(p_ws)
    and private.te_acceso(t.company_id) is not null
    and exists (select 1 from public.empresa_miembros m where m.empresa_id = t.company_id and m.usuario_id = p_user)
    and (t.requester_id = p_user or exists (
      select 1 from ticketeasy.workspace_staff s
      where s.workspace_id = p_ws and s.user_id = p_user
        and (s.category_id is null or s.category_id = any (coalesce((select c.path from ticketeasy.categories c where c.id = t.category_id), '{}')))))
  order by t.updated_at desc
  limit 1000
$$;
revoke execute on function ticketeasy.tickets_como(uuid, uuid) from public, anon;
grant execute on function ticketeasy.tickets_como(uuid, uuid) to authenticated;
