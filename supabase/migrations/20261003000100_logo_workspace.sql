-- Logo del workspace (opcional): se muestra junto a su nombre en los selectores y en la navegación.
-- Sin logo se usa la inicial del nombre. Lo edita quien administra el workspace (RLS "administrar" ya lo cubre)
alter table ticketeasy.workspaces add column logo_url text check (logo_url ~ '^https://\S+$' and char_length(logo_url) <= 1500);
