-- Comunicados del workspace: avisos de estado del servicio (caída, mantención programada, novedad).
-- Se muestran como banner a quienes el workspace admite mientras estén vigentes: activos y dentro de [starts_at, ends_at).
-- ends_at null = sin vencimiento. Los publica y gestiona quien administra el workspace (owner o admin de la empresa).
create table ticketeasy.announcements (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references ticketeasy.workspaces on delete cascade,
  title text check (char_length(btrim(title)) between 1 and 80),
  message text not null check (char_length(btrim(message)) between 1 and 280),
  severity text not null default 'info' check (severity in ('info', 'warning', 'danger')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz check (ends_at > starts_at),
  is_active boolean not null default true,
  created_by uuid default auth.uid() references public.usuarios on delete set null,
  created_at timestamptz not null default now()
);
create index on ticketeasy.announcements (workspace_id, starts_at desc);

alter table ticketeasy.announcements enable row level security;

-- Quien administra ve todos (programados, vencidos, ocultos); el resto, solo los vigentes de un workspace que lo admite
create policy ver on ticketeasy.announcements for select to authenticated
  using (private.te_acceso(private.te_empresa(workspace_id)) is not null and (
    private.te_administra(workspace_id)
    or (private.te_admitido(workspace_id) and is_active and starts_at <= now() and (ends_at is null or ends_at > now()))));
create policy publicar on ticketeasy.announcements for insert to authenticated
  with check (created_by = (select auth.uid()) and private.te_administra(workspace_id)
    and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');
create policy gestionar on ticketeasy.announcements for update to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo')
  with check (private.te_administra(workspace_id));
create policy eliminar on ticketeasy.announcements for delete to authenticated
  using (private.te_administra(workspace_id) and private.te_acceso(private.te_empresa(workspace_id)) = 'completo');

-- Autor, workspace y fechas de creación no se editan
grant select, insert, delete on ticketeasy.announcements to authenticated;
grant update (title, message, severity, starts_at, ends_at, is_active) on ticketeasy.announcements to authenticated;
