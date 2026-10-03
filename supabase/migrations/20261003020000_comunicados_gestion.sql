-- Los comunicados pasan a Gestión: además del owner y el admin de la empresa, los publica el supervisor
-- con alcance en todo el workspace (un comunicado es de todo el workspace). Los agentes no publican.
create function private.te_publica(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.te_rol(ws, null) in ('owner', 'supervisor') or private.rol_en_empresa(w.company_id) = 'admin', false)
  from ticketeasy.workspaces w where w.id = ws
$$;
revoke execute on function private.te_publica(uuid) from public, anon;
grant execute on function private.te_publica(uuid) to authenticated;

drop policy ver on ticketeasy.announcements;
drop policy publicar on ticketeasy.announcements;
drop policy gestionar on ticketeasy.announcements;
drop policy eliminar on ticketeasy.announcements;

create policy ver on ticketeasy.announcements for select to authenticated
  using (private.te_acceso(private.te_empresa(workspace_id)) is not null and (
    private.te_publica(workspace_id)
    or (private.te_admitido(workspace_id) and is_active and starts_at <= now() and (ends_at is null or ends_at > now()))));
create policy publicar on ticketeasy.announcements for insert to authenticated
  with check (created_by = (select auth.uid()) and private.te_publica(workspace_id)
    and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');
create policy gestionar on ticketeasy.announcements for update to authenticated
  using (private.te_publica(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo')
  with check (private.te_publica(workspace_id));
create policy eliminar on ticketeasy.announcements for delete to authenticated
  using (private.te_publica(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');
