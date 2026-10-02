-- Datos de prueba de TicketEasy dentro de la empresa real Fractional IT.
-- Requiere antes, en el repo Nexus: datos_prueba.sql y datos_prueba_fractional.sql. Y en este repo: datos_prueba.sql.
-- Los workspaces llevan id de000000… para que limpiar_datos_prueba.sql los borre sin tocar lo real.
--
-- Soporte a clientes (abierto): lo usan los clientes para pedir ayuda a Fractional IT
--   Soporte TI / Incidentes · Requerimientos      → agente sofia
--   SAP Business One / Integraciones · Reportes   → agente nicolas
--   TicketEasy / Configuración · Plan y facturación
--   Power BI
-- Interno (restringido al grupo Equipo Fractional): Accesos · Equipos · Administración
-- Owner de ambos: el admin real de Fractional IT (administrador de la plataforma).

create function pg_temp.como(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false)
$$;
create function pg_temp.d(u text) returns uuid language sql immutable as $$ select ('de000000-0000-4000-8000-0000000000' || u)::uuid $$;

create function pg_temp.ticket(ws uuid, cat uuid, quien uuid, asunto text, descripcion text, tipo text, prioridad text, campos jsonb, dias int) returns bigint
language plpgsql as $$
declare t bigint;
begin
  perform pg_temp.como(quien);
  insert into ticketeasy.tickets (workspace_id, category_id, requester_id, subject, description, type, priority, custom_fields, created_at)
  values (ws, cat, quien, asunto, descripcion, tipo, prioridad, coalesce(campos, '[]'), now() - make_interval(days => dias))
  returning id into t;
  return t;
end $$;

create function pg_temp.mover(t bigint, quien uuid, estados text[]) returns void language plpgsql as $$
declare e text;
begin
  perform pg_temp.como(quien);
  foreach e in array estados loop
    update ticketeasy.tickets set status = e where id = t;
  end loop;
end $$;

create function pg_temp.msg(t bigint, quien uuid, tipo text, cuerpo text) returns void language plpgsql as $$
begin
  perform pg_temp.como(quien);
  insert into ticketeasy.ticket_messages (ticket_id, author_id, kind, body) values (t, quien, tipo, cuerpo);
end $$;

do $$
declare
  fit uuid := (select id from public.empresas where nombre_comercial = 'Fractional IT' and eliminado_en is null);
  yo uuid;
  sofia uuid := pg_temp.d('a6');
  nicolas uuid := pg_temp.d('a7');
  carolina uuid := pg_temp.d('a1');
  matias uuid := pg_temp.d('c1');
  andres uuid := pg_temp.d('c3');
  cli uuid := pg_temp.d('0a');
  intw uuid := pg_temp.d('0b');
  sti uuid; inc uuid; req uuid; sapc uuid; integ uuid; rep uuid; te uuid; conf uuid; plan uuid; pbi uuid;
  acc uuid; equ uuid; adm uuid;
  t bigint;
  empresa_cliente jsonb := '{"options":[{"value":"Comercial Andes","label":"Comercial Andes"},{"value":"Logística Sur","label":"Logística Sur"},{"value":"Viña Los Robles","label":"Viña Los Robles"},{"value":"Otra","label":"Otra"}]}';
begin
  if fit is null then
    raise exception 'Falta la empresa Fractional IT';
  end if;
  yo := (select usuario_id from public.empresa_miembros
         where empresa_id = fit and rol = 'admin' and usuario_id::text not like 'de000000-%' order by creado_en limit 1);

  insert into ticketeasy.workspaces (id, company_id, name) values (cli, fit, 'Soporte a clientes');
  insert into ticketeasy.workspaces (id, company_id, name, access_mode) values (intw, fit, 'Interno', 'restricted');

  insert into ticketeasy.categories (workspace_id, name) values (cli, 'Soporte TI') returning id into sti;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (cli, sti, 'Incidentes') returning id into inc;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (cli, sti, 'Requerimientos') returning id into req;
  insert into ticketeasy.categories (workspace_id, name) values (cli, 'SAP Business One') returning id into sapc;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (cli, sapc, 'Integraciones') returning id into integ;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (cli, sapc, 'Reportes') returning id into rep;
  insert into ticketeasy.categories (workspace_id, name) values (cli, 'TicketEasy') returning id into te;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (cli, te, 'Configuración') returning id into conf;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (cli, te, 'Plan y facturación') returning id into plan;
  insert into ticketeasy.categories (workspace_id, name) values (cli, 'Power BI') returning id into pbi;
  insert into ticketeasy.categories (workspace_id, name) values (intw, 'Accesos') returning id into acc;
  insert into ticketeasy.categories (workspace_id, name) values (intw, 'Equipos') returning id into equ;
  insert into ticketeasy.categories (workspace_id, name) values (intw, 'Administración') returning id into adm;

  -- Formularios: el de Soporte TI y el de SAP piden la empresa cliente; SAP además la base y el ambiente
  insert into ticketeasy.form_fields (category_id, key, label, field_type, is_required, position, help_text, placeholder, config) values
    (sti, 'empresa', 'Empresa cliente', 'select', true, 0, null, null, empresa_cliente),
    (sti, 'usuarios_afectados', 'Personas afectadas', 'number', false, 1, 'Aproximado, para priorizar.', null, '{}'),
    (sapc, 'empresa', 'Empresa cliente', 'select', true, 0, null, null, empresa_cliente),
    (sapc, 'base_sap', 'Base de datos SAP', 'text', false, 1, null, 'Por ejemplo SBO_ANDES', '{}'),
    (sapc, 'ambiente', 'Ambiente', 'select', true, 2, null, null,
      '{"options":[{"value":"Producción","label":"Producción"},{"value":"Pruebas","label":"Pruebas"}]}'),
    (conf, 'workspace', 'Workspace afectado', 'text', false, 0, 'El nombre del workspace en su TicketEasy.', null, '{}'),
    (pbi, 'tablero', 'Tablero o informe', 'text', true, 0, null, 'Por ejemplo Ventas diarias', '{}'),
    (pbi, 'detalle', 'Qué necesitas', 'rich_text', false, 1, 'Medidas, filtros o vistas que te faltan.', null, '{}');

  insert into ticketeasy.workspace_staff (workspace_id, category_id, user_id, role) values
    (cli, null, yo, 'owner'),
    (cli, sti, sofia, 'agent'),
    (cli, sapc, nicolas, 'agent'),
    (intw, null, yo, 'owner'),
    (intw, null, sofia, 'supervisor');

  insert into ticketeasy.workspace_access (workspace_id, group_id, kind) values (intw, pg_temp.d('c8'), 'allow');

  -- ── Soporte a clientes ──
  t := pg_temp.ticket(cli, plan, carolina, 'Sumar 2 agentes a nuestro TicketEasy', '<p>Crecimos y necesitamos 2 agentes más en el área de TI.</p>', 'request', 'medium', null, 3);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, yo, 'reply', '<p>Con 12 agentes les conviene pasar a <strong>Ultra</strong> (sin límite). Te envío la propuesta hoy.</p>');

  t := pg_temp.ticket(cli, inc, andres, 'Buzones compartidos no aparecen en Outlook', '<p>Después de la migración a Microsoft 365, los buzones compartidos no se ven.</p>', 'incident', 'high',
    '[{"key":"empresa","label":"Empresa cliente","type":"select","value":"Viña Los Robles"},{"key":"usuarios_afectados","label":"Personas afectadas","type":"number","value":"12"}]', 2);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'internal_note', '<p>Faltan los permisos FullAccess con automapping. Lo aplico por PowerShell en la noche.</p>');
  perform pg_temp.msg(t, sofia, 'reply', '<p>Ya identificamos la causa. Hoy en la noche aplicamos el cambio y mañana deberían verlos.</p>');

  t := pg_temp.ticket(cli, plan, matias, 'Renovar el plan de TicketEasy', '<p>Nos aparece que el plan está vencido. ¿Cómo lo regularizamos?</p>', 'question', 'high', null, 0);

  t := pg_temp.ticket(cli, integ, carolina, 'Pedidos de la tienda no llegan a SAP', '<p>Desde el sábado los pedidos web no se crean como órdenes de venta.</p>', 'incident', 'urgent',
    '[{"key":"empresa","label":"Empresa cliente","type":"select","value":"Comercial Andes"},{"key":"base_sap","label":"Base de datos SAP","type":"text","value":"SBO_ANDES"},{"key":"ambiente","label":"Ambiente","type":"select","value":"Producción"}]', 5);
  perform pg_temp.mover(t, nicolas, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, nicolas, 'internal_note', '<p>El token del Service Layer expiró y el conector no lo renovaba. Parche publicado.</p>');
  perform pg_temp.msg(t, nicolas, 'reply', '<p>Corregimos el conector y reprocesamos los 37 pedidos pendientes. ¿Puedes confirmar que ya aparecen en SAP?</p>');
  perform pg_temp.mover(t, nicolas, array['resolved']);

  t := pg_temp.ticket(cli, pbi, carolina, 'Agregar margen por vendedor al tablero de ventas', '<p>Queremos ver el margen, no solo la venta.</p>', 'request', 'low',
    '[{"key":"tablero","label":"Tablero o informe","type":"text","value":"Ventas diarias"},{"key":"detalle","label":"Qué necesitas","type":"rich_text","value":"<ul><li>Margen bruto por vendedor</li><li>Filtro por zona</li></ul>"}]', 8);
  perform pg_temp.mover(t, yo, array['triaged']);

  t := pg_temp.ticket(cli, req, andres, 'Capacitación de Teams para el equipo comercial', '<p>Necesitamos una sesión de 1 hora para 15 personas.</p>', 'request', 'low',
    '[{"key":"empresa","label":"Empresa cliente","type":"select","value":"Viña Los Robles"},{"key":"usuarios_afectados","label":"Personas afectadas","type":"number","value":"15"}]', 14);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'reply', '<p>Quedó agendada para el jueves a las 10:00. Te envié la invitación.</p>');
  perform pg_temp.mover(t, sofia, array['resolved']);
  perform pg_temp.como(andres);
  perform ticketeasy.respond_resolution(t, true, '<p>Excelente sesión, gracias.</p>');

  t := pg_temp.ticket(cli, inc, andres, 'Los correos de la viña caen en spam', '<p>Varios clientes nos dicen que nuestros correos les llegan a spam.</p>', 'incident', 'high',
    '[{"key":"empresa","label":"Empresa cliente","type":"select","value":"Viña Los Robles"}]', 4);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'internal_note', '<p>Falta DKIM y el SPF tiene dos registros. Hay que tocar el DNS: lo escalo.</p>');
  perform pg_temp.mover(t, sofia, array['escalated']);

  t := pg_temp.ticket(cli, conf, matias, 'Crear workspace para bodega', '<p>Queremos un workspace aparte para las bodegas.</p>', 'request', 'medium',
    '[{"key":"workspace","label":"Workspace afectado","type":"text","value":"Bodegas"}]', 1);

  -- ── Interno ──
  t := pg_temp.ticket(intw, adm, sofia, 'Renovar licencias del antivirus', '<p>Vencen a fin de mes las 25 licencias.</p>', 'request', 'medium', null, 6);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, yo, 'reply', '<p>Pedí la cotización de renovación por 2 años.</p>');

  t := pg_temp.ticket(intw, acc, nicolas, 'Acceso a la VPN de Comercial Andes', '<p>Lo necesito para revisar el conector SAP.</p>', 'request', 'high', null, 0);

  t := pg_temp.ticket(intw, equ, nicolas, 'Notebook nuevo para consultor SAP', '<p>El actual tiene 8 GB y no da abasto con el cliente de SAP.</p>', 'request', 'low', null, 9);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress', 'on_hold']);
  perform pg_temp.msg(t, sofia, 'reply', '<p>Esperando que llegue el equipo del proveedor (7 días hábiles).</p>');

  perform set_config('request.jwt.claims', '', false);
end $$;
