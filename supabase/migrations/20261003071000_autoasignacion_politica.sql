-- La asignación automática corre antes de la política de inserción de tickets, que exigía al solicitante crear sin asignado.
-- Con la asignación automática activa se permite el asignado, y el trigger lo fija siempre que quien crea no sea del equipo:
-- un solicitante nunca elige a quién se asigna su ticket (si manda uno, se reemplaza por el del algoritmo).
drop policy crear on ticketeasy.tickets;
create policy crear on ticketeasy.tickets for insert to authenticated
  with check (private.te_acceso(private.te_empresa(workspace_id)) = 'completo' and (
    private.te_rol(workspace_id, category_id) is not null
    or (requester_id = (select auth.uid()) and status = 'new' and private.te_admitido(workspace_id)
        and (assignee_id is null or (select w.auto_assign_enabled from ticketeasy.workspaces w where w.id = workspace_id)))));

create or replace function private.te_ticket_autoasignar() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select auto_assign_enabled from ticketeasy.workspaces where id = new.workspace_id)
     and (new.assignee_id is null or private.te_rol(new.workspace_id, new.category_id) is null) then
    new.assignee_id := private.te_autoasignar(new.workspace_id, new.category_id);
  end if;
  return new;
end $$;
