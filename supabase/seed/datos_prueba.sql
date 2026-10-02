-- Datos de prueba de TicketEasy. Requiere antes el seed del núcleo (repo Nexus: supabase/seed/datos_prueba.sql).
-- Los tickets avanzan por su ciclo de vida actuando como cada persona, así la conversación queda con los
-- cambios de estado y el rol de quien escribió, igual que en la app. Se borra con limpiar_datos_prueba.sql.
--
-- Comercial Andes (Pro):
--   TI (abierto)          Soporte / Hardware · Software y Office · Accesos y cuentas
--                         Desarrollo / Apps / App Ventas · App Bodega
--                         SAP Business One / Facturación · Inventario
--     owner carolina · supervisor diego (todo) · agente pablo (Soporte) · agente fernanda (Desarrollo/Apps)
--   Personas (restringido: grupo Finanzas y javier)   Remuneraciones · Vacaciones · Certificados
--     owner carolina · agente rocio
--   Formularios propios: Hardware, Apps (lo heredan App Ventas y App Bodega), SAP, Vacaciones, Certificados
-- Logística Sur (Básica, queda vencida hace 3 días → solo lectura):
--   Soporte (abierto)     Equipos · Redes · owner matias · agente fernanda

create function pg_temp.como(u text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', 'de000000-0000-4000-8000-0000000000' || u, 'role', 'authenticated')::text, false)
$$;
create function pg_temp.id(u text) returns uuid language sql immutable as $$ select ('de000000-0000-4000-8000-0000000000' || u)::uuid $$;

-- Ticket abierto por el solicitante hace n días
create function pg_temp.ticket(ws uuid, cat uuid, quien text, asunto text, descripcion text, tipo text, prioridad text, campos jsonb, dias int) returns bigint
language plpgsql as $$
declare t bigint;
begin
  perform pg_temp.como(quien);
  insert into ticketeasy.tickets (workspace_id, category_id, requester_id, subject, description, type, priority, custom_fields, created_at)
  values (ws, cat, pg_temp.id(quien), asunto, descripcion, tipo, prioridad, coalesce(campos, '[]'), now() - make_interval(days => dias))
  returning id into t;
  return t;
end $$;

-- Recorre estados como esa persona (el trigger valida cada salto y lo deja en la conversación)
create function pg_temp.mover(t bigint, quien text, estados text[]) returns void language plpgsql as $$
declare e text;
begin
  perform pg_temp.como(quien);
  foreach e in array estados loop
    update ticketeasy.tickets set status = e where id = t;
  end loop;
end $$;

create function pg_temp.msg(t bigint, quien text, tipo text, cuerpo text) returns void language plpgsql as $$
begin
  perform pg_temp.como(quien);
  insert into ticketeasy.ticket_messages (ticket_id, author_id, kind, body) values (t, pg_temp.id(quien), tipo, cuerpo);
end $$;

do $$
declare
  andes uuid := pg_temp.id('e1');
  sur uuid := pg_temp.id('e2');
  ti uuid; per uuid; sopws uuid;
  soporte uuid; hw uuid; sw uuid; acc uuid; dev uuid; apps uuid; appv uuid; appb uuid; sap uuid; fact uuid; inv uuid;
  rem uuid; vac uuid; cert uuid; equipos uuid; redes uuid;
  t bigint;
begin
  -- Workspaces y árbol de categorías
  insert into ticketeasy.workspaces (company_id, name) values (andes, 'TI') returning id into ti;
  insert into ticketeasy.workspaces (company_id, name, access_mode) values (andes, 'Personas', 'restricted') returning id into per;
  insert into ticketeasy.workspaces (company_id, name) values (sur, 'Soporte') returning id into sopws;

  insert into ticketeasy.categories (workspace_id, name) values (ti, 'Soporte') returning id into soporte;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, soporte, 'Hardware') returning id into hw;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, soporte, 'Software y Office') returning id into sw;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, soporte, 'Accesos y cuentas') returning id into acc;
  insert into ticketeasy.categories (workspace_id, name) values (ti, 'Desarrollo') returning id into dev;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, dev, 'Apps') returning id into apps;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, apps, 'App Ventas') returning id into appv;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, apps, 'App Bodega') returning id into appb;
  insert into ticketeasy.categories (workspace_id, name) values (ti, 'SAP Business One') returning id into sap;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, sap, 'Facturación') returning id into fact;
  insert into ticketeasy.categories (workspace_id, parent_id, name) values (ti, sap, 'Inventario') returning id into inv;
  insert into ticketeasy.categories (workspace_id, name) values (per, 'Remuneraciones') returning id into rem;
  insert into ticketeasy.categories (workspace_id, name) values (per, 'Vacaciones') returning id into vac;
  insert into ticketeasy.categories (workspace_id, name) values (per, 'Certificados') returning id into cert;
  insert into ticketeasy.categories (workspace_id, name) values (sopws, 'Equipos') returning id into equipos;
  insert into ticketeasy.categories (workspace_id, name) values (sopws, 'Redes') returning id into redes;

  -- Formularios propios (las subcategorías heredan el de su padre)
  insert into ticketeasy.form_fields (category_id, key, label, field_type, is_required, position, help_text, placeholder, config) values
    (hw, 'equipo', 'Equipo afectado', 'select', true, 0, null, null,
      '{"options":[{"value":"Notebook","label":"Notebook"},{"value":"Escritorio","label":"Escritorio"},{"value":"Impresora","label":"Impresora"},{"value":"Monitor","label":"Monitor"}]}'),
    (hw, 'serie', 'Número de serie', 'text', false, 1, 'Está en la etiqueta bajo el equipo.', 'Por ejemplo 5CG1234XYZ', '{}'),
    (apps, 'aplicacion', 'Aplicación', 'select', true, 0, null, null,
      '{"options":[{"value":"App Ventas","label":"App Ventas"},{"value":"App Bodega","label":"App Bodega"}]}'),
    (apps, 'pasos', 'Pasos para reproducir', 'rich_text', false, 1, 'Qué hiciste justo antes del error.', null, '{}'),
    (sap, 'documento', 'N° de documento', 'text', false, 0, 'Factura, guía u orden relacionada, si la hay.', 'Por ejemplo Factura 10234', '{}'),
    (sap, 'ambiente', 'Ambiente', 'select', true, 1, null, null,
      '{"options":[{"value":"Producción","label":"Producción"},{"value":"Pruebas","label":"Pruebas"}]}'),
    (vac, 'desde', 'Desde', 'date', true, 0, null, null, '{}'),
    (vac, 'hasta', 'Hasta', 'date', true, 1, null, null, '{}'),
    (vac, 'reemplazo', 'Quién te reemplaza', 'text', false, 2, null, 'Nombre de tu reemplazo', '{}'),
    (cert, 'tipo_certificado', 'Tipo de certificado', 'select', true, 0, null, null,
      '{"options":[{"value":"Antigüedad","label":"Antigüedad"},{"value":"Renta","label":"Renta"}]}'),
    (cert, 'para', 'Para presentar en', 'text', false, 1, null, 'Banco, AFP, embajada…', '{}');

  -- Equipo (cada persona distinta ocupa un cupo del plan)
  insert into ticketeasy.workspace_staff (workspace_id, category_id, user_id, role) values
    (ti, null, pg_temp.id('a1'), 'owner'),
    (ti, null, pg_temp.id('a2'), 'supervisor'),
    (ti, soporte, pg_temp.id('a3'), 'agent'),
    (ti, apps, pg_temp.id('a4'), 'agent'),
    (per, null, pg_temp.id('a1'), 'owner'),
    (per, null, pg_temp.id('a5'), 'agent'),
    (sopws, null, pg_temp.id('c1'), 'owner'),
    (sopws, null, pg_temp.id('a4'), 'agent');

  -- Personas es restringido: solo Finanzas y Javier pueden abrir tickets
  insert into ticketeasy.workspace_access (workspace_id, group_id, kind)
    select per, id, 'allow' from public.grupos where empresa_id = andes and nombre = 'Finanzas';
  insert into ticketeasy.workspace_access (workspace_id, user_id, kind) values (per, pg_temp.id('b1'), 'allow');

  -- ── Tickets de Comercial Andes ──
  t := pg_temp.ticket(ti, fact, 'b1', 'No puedo emitir facturas electrónicas', '<p>Desde esta mañana SAP rechaza todas las facturas con un error del SII.</p>', 'incident', 'urgent',
    '[{"key":"documento","label":"N° de documento","type":"text","value":"Factura 10234"},{"key":"ambiente","label":"Ambiente","type":"select","value":"Producción"}]', 4);
  perform pg_temp.mover(t, 'a2', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a2', 'internal_note', '<p>El certificado digital del SII venció ayer. Pedí la renovación al proveedor.</p>');
  perform pg_temp.msg(t, 'a2', 'reply', '<p>Estamos renovando el certificado digital. Te aviso apenas puedas volver a emitir.</p>');

  t := pg_temp.ticket(ti, hw, 'b2', 'El notebook no carga', '<p>Lo conecto y la luz del cargador no enciende.</p>', 'incident', 'high',
    '[{"key":"equipo","label":"Equipo afectado","type":"select","value":"Notebook"},{"key":"serie","label":"Número de serie","type":"text","value":"5CG1234XYZ"}]', 2);
  perform pg_temp.mover(t, 'a3', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a3', 'reply', '<p>¿Puedes traer el cargador a la oficina de TI? Quiero descartar que sea el cable.</p>');
  perform pg_temp.mover(t, 'a3', array['on_hold']);
  perform pg_temp.msg(t, 'b2', 'reply', '<p>Mañana a primera hora lo llevo.</p>');

  t := pg_temp.ticket(ti, appb, 'b3', 'La App Bodega se cierra al escanear', '<p>Cada vez que escaneo una guía de despacho la app se cierra.</p>', 'incident', 'high',
    '[{"key":"aplicacion","label":"Aplicación","type":"select","value":"App Bodega"},{"key":"pasos","label":"Pasos para reproducir","type":"rich_text","value":"<ol><li>Abrir Recepción</li><li>Tocar Escanear</li><li>Apuntar a la guía</li></ol>"}]', 6);
  perform pg_temp.mover(t, 'a4', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a4', 'internal_note', '<p>Falla con guías de más de 40 líneas: el lector se queda sin memoria.</p>');
  perform pg_temp.msg(t, 'a4', 'reply', '<p>Publicamos la versión <strong>2.3.1</strong>, que corrige el escáner. ¿Puedes probar y confirmar?</p>');
  perform pg_temp.mover(t, 'a4', array['resolved']);

  t := pg_temp.ticket(ti, acc, 'b1', 'Acceso a la carpeta compartida de Ventas', '<p>Necesito acceso de lectura a la carpeta de cotizaciones.</p>', 'request', 'medium', null, 10);
  perform pg_temp.mover(t, 'a3', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a3', 'reply', '<p>Listo, ya tienes acceso de lectura. Cierra sesión y vuelve a entrar para verla.</p>');
  perform pg_temp.mover(t, 'a3', array['resolved']);
  perform pg_temp.como('b1');
  perform ticketeasy.respond_resolution(t, true, '<p>Ya la veo, gracias.</p>');

  t := pg_temp.ticket(ti, sw, 'b2', 'Outlook pide la contraseña a cada rato', '<p>Desde ayer Outlook me pide la contraseña cada pocos minutos.</p>', 'incident', 'medium', null, 0);

  t := pg_temp.ticket(ti, null, 'b3', '¿Cómo conecto la impresora de bodega?', '<p>Me cambiaron de puesto y no sé cómo agregar la impresora.</p>', 'question', 'low', null, 1);

  t := pg_temp.ticket(ti, inv, 'b1', 'El stock no coincide entre bodegas', '<p>SAP muestra 120 unidades del SKU 4410 en Bodega Norte, pero físicamente hay 85.</p>', 'problem', 'high',
    '[{"key":"ambiente","label":"Ambiente","type":"select","value":"Producción"}]', 7);
  perform pg_temp.mover(t, 'a2', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a2', 'internal_note', '<p>Se repite en tres tickets esta semana. Escalo al partner SAP para revisar las transferencias.</p>');
  perform pg_temp.mover(t, 'a2', array['escalated']);

  t := pg_temp.ticket(ti, sw, 'b2', 'Excel se congela con macros', '<p>El archivo de cierre mensual deja de responder al ejecutar la macro.</p>', 'incident', 'medium', null, 5);
  perform pg_temp.mover(t, 'a3', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a3', 'reply', '<p>Actualizamos Office a la última versión. Prueba de nuevo, por favor.</p>');
  perform pg_temp.mover(t, 'a3', array['resolved']);
  perform pg_temp.como('b2');
  perform ticketeasy.respond_resolution(t, false, '<p>Sigue pasando con el archivo de cierre mensual.</p>');

  t := pg_temp.ticket(ti, appv, 'b1', 'Filtro por vendedor en App Ventas', '<p>Sería útil filtrar el reporte diario por vendedor.</p>', 'request', 'low',
    '[{"key":"aplicacion","label":"Aplicación","type":"select","value":"App Ventas"}]', 12);
  perform pg_temp.mover(t, 'a4', array['triaged']);
  perform pg_temp.msg(t, 'a4', 'reply', '<p>Lo agregamos al plan del próximo sprint.</p>');

  t := pg_temp.ticket(per, vac, 'b2', 'Vacaciones de invierno', '<p>Quiero tomar una semana de vacaciones en julio.</p>', 'request', 'medium',
    format('[{"key":"desde","label":"Desde","type":"date","value":"%s"},{"key":"hasta","label":"Hasta","type":"date","value":"%s"},{"key":"reemplazo","label":"Quién te reemplaza","type":"text","value":"Javier Pérez"}]',
      current_date + 30, current_date + 37)::jsonb, 15);
  perform pg_temp.mover(t, 'a5', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a5', 'reply', '<p>Aprobadas. Quedaron registradas en el sistema de remuneraciones.</p>');
  perform pg_temp.mover(t, 'a5', array['resolved']);
  perform pg_temp.como('b2');
  perform ticketeasy.respond_resolution(t, true, null);

  t := pg_temp.ticket(per, cert, 'b1', 'Certificado de antigüedad', '<p>Lo necesito para un crédito hipotecario.</p>', 'request', 'low',
    '[{"key":"tipo_certificado","label":"Tipo de certificado","type":"select","value":"Antigüedad"},{"key":"para","label":"Para presentar en","type":"text","value":"Banco"}]', 1);

  t := pg_temp.ticket(per, rem, 'b2', 'Diferencia en la liquidación de septiembre', '<p>Me descontaron horas extra que sí trabajé.</p>', 'question', 'high', null, 3);
  perform pg_temp.mover(t, 'a5', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a5', 'internal_note', '<p>Revisar con contabilidad el registro de asistencia del 18 al 22.</p>');

  -- ── Tickets de Logística Sur ──
  t := pg_temp.ticket(sopws, redes, 'c2', 'La VPN no conecta desde casa', '<p>Me aparece "tiempo de espera agotado" al conectar.</p>', 'incident', 'high', null, 2);
  perform pg_temp.mover(t, 'a4', array['triaged', 'in_progress']);
  perform pg_temp.msg(t, 'a4', 'reply', '<p>Te reenvié el perfil de VPN actualizado a tu correo. Instálalo y me cuentas.</p>');

  t := pg_temp.ticket(sopws, equipos, 'c2', 'Necesito un mouse nuevo', '<p>El mío dejó de funcionar.</p>', 'request', 'low', null, 0);

  perform set_config('request.jwt.claims', '', false);
end $$;

-- Logística Sur queda con el cobro vencido hace 3 días: TicketEasy en solo lectura (gracia).
-- Va al final porque con el plan vencido el cupo de agentes es 0 y no se podría armar el equipo.
update public.suscripciones set proximo_cobro = current_date - 3 where id = 'de000000-0000-4000-8000-0000000000f3';
