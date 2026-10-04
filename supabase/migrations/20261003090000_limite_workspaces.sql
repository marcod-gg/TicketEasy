-- Límite de workspaces por plan (clave "workspaces" en productos.limites, como "agentes"): Básica 2, Pro 5, Ultra sin límite.
-- Un plan sin la clave no limita (limite_plan devolvería 0 y bloquearía a todos). Lo valida un trigger al crear; la app lo
-- consulta antes con workspace_quota para mostrar "Alcanzaste tu límite, mejora tu plan".
update public.productos set limites = limites || '{"workspaces": 2}' where app = 'ticketeasy' and nombre = 'TicketEasy Básica (demo)';
update public.productos set limites = limites || '{"workspaces": 5}' where app = 'ticketeasy' and nombre = 'TicketEasy Pro (demo)';
update public.productos set limites = limites || '{"workspaces": null}' where app = 'ticketeasy' and nombre = 'TicketEasy Ultra (demo)';

-- Tope de workspaces de la empresa: null = sin límite (también si ningún plan vigente define la clave)
create function private.te_limite_workspaces(empresa uuid) returns int
language sql stable security definer set search_path = '' as $$
  select case when bool_or(p.limites ? 'workspaces') then private.limite_plan('ticketeasy', empresa, 'workspaces') end
  from public.suscripciones s join public.productos p on p.id = s.producto_id
  where s.empresa_id = empresa and s.usuario_id is null and p.app = 'ticketeasy' and s.eliminado_en is null
    and s.estado in ('activa', 'cancelada') and (s.proximo_cobro is null or s.proximo_cobro >= current_date)
$$;

-- ponytail: dos altas simultáneas pueden pasar el conteo a la vez; bloquear por empresa (advisory lock) si llega a importar
create function private.te_workspace_cupo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  limite int := private.te_limite_workspaces(new.company_id);
begin
  if limite is not null and (select count(*) from ticketeasy.workspaces where company_id = new.company_id) >= limite then
    raise exception 'Alcanzaste el límite de % workspaces de tu plan. Mejora tu plan para crear más.', limite using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger te_workspace_cupo before insert on ticketeasy.workspaces
for each row execute function private.te_workspace_cupo();

-- Uso y tope para la app: { "used": n, "limit": n | null }. Solo para miembros de la empresa
create function ticketeasy.workspace_quota(p_company uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('used', (select count(*) from ticketeasy.workspaces where company_id = p_company),
                            'limit', private.te_limite_workspaces(p_company))
  where private.rol_en_empresa(p_company) is not null
$$;

revoke execute on function private.te_limite_workspaces(uuid), private.te_workspace_cupo() from public, anon;
revoke execute on function ticketeasy.workspace_quota(uuid) from public, anon;
grant execute on function ticketeasy.workspace_quota(uuid) to authenticated;
