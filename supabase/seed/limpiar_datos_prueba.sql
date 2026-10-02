-- Borra los datos de prueba de TicketEasy: empresas demo (de000000…) y workspaces demo dentro de Fractional IT.
-- Después, el limpiar del núcleo (repo Nexus).
delete from ticketeasy.tickets where company_id::text like 'de000000-%' or workspace_id::text like 'de000000-%';   -- arrastra mensajes
delete from ticketeasy.workspaces where company_id::text like 'de000000-%' or id::text like 'de000000-%';          -- arrastra categorías, formularios, equipo y accesos
