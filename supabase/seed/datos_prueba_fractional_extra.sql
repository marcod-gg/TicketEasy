-- 20 tickets más en los workspaces demo de Fractional IT (Soporte a clientes e Interno), para probar las vistas de Tickets:
-- "Ingresados por mí" (los abre el admin real), "Asignados a mí" (los atiende el admin real) y "Todos los tickets".
-- Requiere antes datos_prueba_fractional.sql. Se borra con limpiar_datos_prueba.sql (workspaces de000000…).
-- Mismo método: cada paso actúa como la persona que lo haría, así los triggers dejan conversación, notificaciones y roles.

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

-- Categoría por workspace y nombre
create function pg_temp.cat(ws uuid, nombre text) returns uuid language sql as $$
  select id from ticketeasy.categories where workspace_id = ws and name = nombre
$$;

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
  inc uuid := pg_temp.cat(pg_temp.d('0a'), 'Incidentes');
  req uuid := pg_temp.cat(pg_temp.d('0a'), 'Requerimientos');
  integ uuid := pg_temp.cat(pg_temp.d('0a'), 'Integraciones');
  rep uuid := pg_temp.cat(pg_temp.d('0a'), 'Reportes');
  conf uuid := pg_temp.cat(pg_temp.d('0a'), 'Configuración');
  plan uuid := pg_temp.cat(pg_temp.d('0a'), 'Plan y facturación');
  pbi uuid := pg_temp.cat(pg_temp.d('0a'), 'Power BI');
  acc uuid := pg_temp.cat(pg_temp.d('0b'), 'Accesos');
  equ uuid := pg_temp.cat(pg_temp.d('0b'), 'Equipos');
  adm uuid := pg_temp.cat(pg_temp.d('0b'), 'Administración');
  t bigint;
  andes text := '{"key":"empresa","label":"Empresa cliente","type":"select","value":"Comercial Andes"}';
  logis text := '{"key":"empresa","label":"Empresa cliente","type":"select","value":"Logística Sur"}';
  vina text := '{"key":"empresa","label":"Empresa cliente","type":"select","value":"Viña Los Robles"}';
  prod text := '{"key":"ambiente","label":"Ambiente","type":"select","value":"Producción"}';
  pruebas text := '{"key":"ambiente","label":"Ambiente","type":"select","value":"Pruebas"}';
begin
  if fit is null or inc is null or acc is null then
    raise exception 'Faltan los workspaces demo de Fractional IT: corre antes datos_prueba_fractional.sql';
  end if;
  yo := (select usuario_id from public.empresa_miembros
         where empresa_id = fit and rol = 'admin' and usuario_id::text not like 'de000000-%' order by creado_en limit 1);

  -- ── Soporte a clientes ──
  t := pg_temp.ticket(cli, inc, carolina, 'Impresora de bodega no imprime guías', '<p>La Zebra de bodega dejó de imprimir las guías de despacho.</p>', 'incident', 'high', format('[%s]', andes)::jsonb, 1);
  perform pg_temp.mover(t, sofia, array['triaged']);

  t := pg_temp.ticket(cli, inc, matias, 'Wifi intermitente en la oficina de Puerto Montt', '<p>Se corta cada 10 minutos desde ayer.</p>', 'incident', 'urgent', format('[%s]', logis)::jsonb, 0);

  t := pg_temp.ticket(cli, integ, carolina, 'Facturas electrónicas rechazadas por el SII', '<p>Las facturas de hoy vuelven rechazadas con error de firma.</p>', 'incident', 'urgent',
    format('[%s,%s]', andes, prod)::jsonb, 1);
  perform pg_temp.mover(t, nicolas, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, nicolas, 'internal_note', '<p>El certificado digital venció ayer. Pido el nuevo a la empresa.</p>');
  perform pg_temp.mover(t, nicolas, array['on_hold']);
  perform pg_temp.msg(t, nicolas, 'reply', '<p>El certificado de firma venció. Necesitamos que nos envíen el nuevo para reactivarlo.</p>');

  t := pg_temp.ticket(cli, rep, andres, 'Informe de ventas por canal en SAP', '<p>Necesitamos separar venta web, mayorista y tienda.</p>', 'request', 'medium',
    format('[%s,%s]', vina, prod)::jsonb, 6);
  perform pg_temp.mover(t, nicolas, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, nicolas, 'reply', '<p>Armé un borrador del informe. ¿Pueden revisarlo en el ambiente de pruebas?</p>');

  t := pg_temp.ticket(cli, pbi, matias, 'Tablero de entregas a tiempo', '<p>Queremos medir el % de entregas dentro del plazo por ruta.</p>', 'request', 'medium',
    '[{"key":"tablero","label":"Tablero o informe","type":"text","value":"Despachos"}]', 10);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, yo, 'reply', '<p>Ya tengo el modelo con las rutas. Esta semana publico la primera versión.</p>');

  t := pg_temp.ticket(cli, conf, carolina, 'Cambiar el logo de nuestro TicketEasy', '<p>Tenemos logo nuevo, ¿cómo lo cambiamos?</p>', 'question', 'low', null, 3);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, yo, 'reply', '<p>Lo cambias en Administración → Marca, con la URL del logo. Te dejé el paso a paso.</p>');
  perform pg_temp.mover(t, yo, array['resolved']);

  t := pg_temp.ticket(cli, plan, andres, 'Factura de septiembre con monto distinto', '<p>Nos llegó un monto mayor al del plan contratado.</p>', 'question', 'medium', null, 2);
  perform pg_temp.mover(t, yo, array['triaged']);

  t := pg_temp.ticket(cli, req, matias, 'Crear cuenta de correo para nuevo conductor', '<p>Ingresa el lunes Pedro Salinas, conductor de la ruta sur.</p>', 'request', 'medium', format('[%s]', logis)::jsonb, 4);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'reply', '<p>Cuenta creada: psalinas@logisticasur.cl. Les envío la clave por canal seguro.</p>');
  perform pg_temp.mover(t, sofia, array['resolved']);
  perform pg_temp.como(matias);
  perform ticketeasy.respond_resolution(t, true, '<p>Perfecto, gracias.</p>');

  t := pg_temp.ticket(cli, inc, andres, 'Computador de recepción muy lento', '<p>Demora 10 minutos en encender.</p>', 'incident', 'low', format('[%s]', vina)::jsonb, 12);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'reply', '<p>Le cambiamos el disco por uno SSD. Ahora enciende en menos de un minuto.</p>');
  perform pg_temp.mover(t, sofia, array['resolved']);
  perform pg_temp.como(andres);
  perform ticketeasy.respond_resolution(t, false, '<p>Mejoró, pero Outlook sigue tardando mucho en abrir.</p>');

  t := pg_temp.ticket(cli, integ, carolina, 'Sincronizar stock de SAP con la tienda web', '<p>El stock de la web queda desfasado varias horas.</p>', 'problem', 'high',
    format('[%s,%s]', andes, pruebas)::jsonb, 7);
  perform pg_temp.mover(t, nicolas, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, nicolas, 'internal_note', '<p>El proceso corre cada 6 horas. Hay que pasarlo a eventos del Service Layer: lo escalo.</p>');
  perform pg_temp.mover(t, nicolas, array['escalated']);

  t := pg_temp.ticket(cli, req, carolina, 'Habilitar MFA para todo el equipo', '<p>Queremos activar doble factor en Microsoft 365.</p>', 'request', 'high', format('[%s]', andes)::jsonb, 0);

  t := pg_temp.ticket(cli, pbi, andres, 'Actualización del tablero de cosecha falla', '<p>El tablero no se actualiza desde el lunes.</p>', 'incident', 'medium',
    '[{"key":"tablero","label":"Tablero o informe","type":"text","value":"Cosecha 2026"}]', 2);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);

  -- ── Interno (lo usa el equipo de Fractional IT) ──
  t := pg_temp.ticket(intw, acc, yo, 'Acceso de Nicolás al tenant de Logística Sur', '<p>Necesita permisos de administrador de SAP en Logística Sur.</p>', 'request', 'high', null, 1);
  perform pg_temp.mover(t, sofia, array['triaged']);

  t := pg_temp.ticket(intw, equ, yo, 'Monitor extra para la sala de reuniones', '<p>Para las demos a clientes.</p>', 'request', 'low', null, 5);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'reply', '<p>Cotizado: llega el viernes.</p>');

  t := pg_temp.ticket(intw, adm, yo, 'Renovar dominio fractionalit.cl', '<p>Vence el 30 de octubre.</p>', 'request', 'urgent', null, 2);
  perform pg_temp.mover(t, sofia, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, sofia, 'reply', '<p>Renovado por 3 años. Te dejo el comprobante en la carpeta de administración.</p>');
  perform pg_temp.mover(t, sofia, array['resolved']);

  t := pg_temp.ticket(intw, acc, sofia, 'Licencia de Power BI Pro para Sofía', '<p>Para publicar los tableros de clientes.</p>', 'request', 'medium', null, 3);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);

  t := pg_temp.ticket(intw, equ, sofia, 'Batería del notebook se descarga rápido', '<p>Dura menos de una hora.</p>', 'incident', 'medium', null, 8);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress', 'on_hold']);
  perform pg_temp.msg(t, yo, 'reply', '<p>Pedí la batería de reemplazo a garantía; demora unos 10 días.</p>');

  t := pg_temp.ticket(intw, adm, nicolas, 'Reembolso de pasajes a Puerto Montt', '<p>Viaje a Logística Sur del 22 de septiembre.</p>', 'request', 'low', null, 11);
  perform pg_temp.mover(t, yo, array['triaged', 'in_progress']);
  perform pg_temp.msg(t, yo, 'reply', '<p>Transferido. Queda en la rendición de octubre.</p>');
  perform pg_temp.mover(t, yo, array['resolved']);
  perform pg_temp.como(nicolas);
  perform ticketeasy.respond_resolution(t, true, null);

  t := pg_temp.ticket(intw, acc, yo, 'Revisar permisos de la carpeta compartida de clientes', '<p>Hay personas que ya no deberían tener acceso.</p>', 'problem', 'high', null, 0);

  t := pg_temp.ticket(intw, equ, nicolas, 'Cable HDMI dañado en la sala chica', '<p>El proyector parpadea.</p>', 'incident', 'low', null, 4);
  perform pg_temp.mover(t, sofia, array['triaged']);

  perform set_config('request.jwt.claims', '', false);
end $$;
