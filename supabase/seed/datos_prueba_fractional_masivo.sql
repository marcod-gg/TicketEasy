-- 100 tickets de prueba en los workspaces demo de Fractional IT: 50 en Soporte a clientes y 50 en Interno.
-- Para probar volumen en Tickets (vistas, segmentos, tablero, filtros) e Inicio. Requiere antes datos_prueba_fractional.sql
-- y la migración del estado Cancelado. Se borra con limpiar_datos_prueba.sql (workspaces de000000…).
-- Determinista: el ticket n toma asunto, persona, categoría, prioridad, tipo y recorrido según n, repartidos en 60 días.
-- Cada paso actúa como quien lo haría, así los triggers dejan conversación, notificaciones, fechas y roles.

create function pg_temp.como(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false)
$$;
create function pg_temp.d(u text) returns uuid language sql immutable as $$ select ('de000000-0000-4000-8000-0000000000' || u)::uuid $$;
create function pg_temp.cat(ws uuid, nombre text) returns uuid language sql as $$
  select id from ticketeasy.categories where workspace_id = ws and name = nombre
$$;
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

-- Un ticket: lo abre `quien` y lo recorre `agente` según `ruta` (0..11). anterior = ticket previo del workspace (duplicados)
create function pg_temp.lote(ws uuid, n int, cat uuid, quien uuid, agente uuid, asunto text, campos jsonb, anterior bigint, aviso bigint) returns bigint
language plpgsql as $$
declare
  t bigint;
  ruta int := n % 12;
  prio text := (array['low', 'medium', 'medium', 'high', 'urgent'])[1 + n % 5];
  tipo text := (array['incident', 'request', 'question', 'request', 'problem'])[1 + (n * 7) % 5];
begin
  perform pg_temp.como(quien);
  insert into ticketeasy.tickets (workspace_id, category_id, requester_id, subject, description, type, priority, custom_fields, created_at)
  values (ws, cat, quien, asunto, format('<p>%s. Lo necesitamos resuelto para seguir trabajando.</p>', asunto), tipo, prio, coalesce(campos, '[]'),
          now() - make_interval(days => (n * 37) % 60, hours => (n * 5) % 24))
  returning id into t;

  case ruta
    when 0, 1 then null;                                                         -- nuevo
    when 2 then perform pg_temp.mover(t, agente, array['triaged']);
    when 3, 4 then
      perform pg_temp.mover(t, agente, array['triaged', 'in_progress']);
      perform pg_temp.msg(t, agente, 'reply', '<p>Lo estamos revisando; te aviso apenas tenga novedades.</p>');
    when 5 then
      perform pg_temp.mover(t, agente, array['triaged', 'in_progress']);
      perform pg_temp.msg(t, agente, 'reply', '<p>Necesitamos que nos confirmes el horario en que ocurre para seguir.</p>');
      perform pg_temp.mover(t, agente, array['on_hold']);
    when 6 then
      perform pg_temp.mover(t, agente, array['triaged', 'in_progress']);
      perform pg_temp.msg(t, agente, 'reply', '<p>Quedó corregido. ¿Puedes confirmar que ya funciona?</p>');
      perform pg_temp.mover(t, agente, array['resolved']);
    when 7, 8 then
      perform pg_temp.mover(t, agente, array['triaged', 'in_progress']);
      perform pg_temp.msg(t, agente, 'reply', '<p>Listo, aplicamos el cambio.</p>');
      perform pg_temp.mover(t, agente, array['resolved']);
      perform pg_temp.como(quien);
      perform ticketeasy.respond_resolution(t, true, '<p>Funciona, gracias.</p>');
    when 9 then
      perform pg_temp.mover(t, agente, array['triaged', 'in_progress']);
      perform pg_temp.msg(t, agente, 'internal_note', '<p>Requiere acceso de administrador que no tengo: lo escalo.</p>');
      perform pg_temp.mover(t, agente, array['escalated']);
    when 10 then
      perform pg_temp.mover(t, agente, array['triaged', 'in_progress', 'resolved']);
      perform pg_temp.como(quien);
      perform ticketeasy.respond_resolution(t, false, '<p>Sigue pasando de vez en cuando.</p>');
    else                                                                         -- 11: cancelado, con un motivo que rota
      perform pg_temp.como(agente);
      if n % 4 = 3 and anterior is not null then
        update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'duplicate', duplicate_of = anterior where id = t;
        perform pg_temp.msg(t, agente, 'reply', format('<p>Lo cerramos como duplicado del ticket #%s, donde seguimos atendiendo.</p>', anterior));
      elsif n % 4 = 2 and aviso is not null then
        update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'announcement', announcement_id = aviso where id = t;
        perform pg_temp.msg(t, agente, 'reply', '<p>Es parte de la incidencia informada en el comunicado del workspace.</p>');
      elsif n % 4 = 1 then
        update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'withdrawn' where id = t;
        perform pg_temp.msg(t, agente, 'reply', '<p>Lo cancelamos porque nos indicaste que ya no lo necesitas.</p>');
      else
        update ticketeasy.tickets set status = 'cancelled', cancel_reason = 'not_applicable' where id = t;
        perform pg_temp.msg(t, agente, 'reply', '<p>Esta solicitud no corresponde a esta mesa de ayuda; te indicamos a quién dirigirla.</p>');
      end if;
  end case;
  return t;
end $$;

do $$
declare
  fit uuid := (select id from public.empresas where nombre_comercial = 'Fractional IT' and eliminado_en is null);
  yo uuid;
  sofia uuid := pg_temp.d('a6');
  nicolas uuid := pg_temp.d('a7');
  clientes uuid[] := array[pg_temp.d('a1'), pg_temp.d('c1'), pg_temp.d('c3')];   -- carolina, matias, andres
  cli uuid := pg_temp.d('0a');
  intw uuid := pg_temp.d('0b');
  aviso_cli bigint := (select max(id) from ticketeasy.announcements where workspace_id = pg_temp.d('0a'));
  aviso_int bigint := (select max(id) from ticketeasy.announcements where workspace_id = pg_temp.d('0b'));
  empresas text[] := array['Comercial Andes', 'Logística Sur', 'Viña Los Robles'];
  -- Soporte a clientes: [categoría, asunto]; la categoría decide quién atiende
  sc text[][] := array[
    ['Incidentes', 'No llegan los correos de la casilla de ventas'], ['Incidentes', 'Outlook pide la clave a cada rato'],
    ['Incidentes', 'Se cae la VPN al conectar desde la casa'], ['Incidentes', 'Teams no comparte pantalla'],
    ['Incidentes', 'El escáner de bodega no lee los códigos'], ['Incidentes', 'Impresora de facturación atascada'],
    ['Incidentes', 'OneDrive no sincroniza la carpeta compartida'], ['Incidentes', 'Notebook no enciende después de actualizar'],
    ['Requerimientos', 'Crear usuario para nueva vendedora'], ['Requerimientos', 'Dar acceso a la carpeta de contabilidad'],
    ['Requerimientos', 'Instalar Office en equipo nuevo'], ['Requerimientos', 'Configurar firma de correo corporativa'],
    ['Requerimientos', 'Habilitar lista de distribución de despacho'], ['Requerimientos', 'Dar de baja cuenta de ex trabajador'],
    ['Integraciones', 'Órdenes de compra duplicadas en SAP'], ['Integraciones', 'La tienda web no descuenta stock'],
    ['Integraciones', 'Error de timbraje al emitir guías'], ['Integraciones', 'Pagos de Transbank no se concilian'],
    ['Reportes', 'Informe de cuentas por cobrar vencidas'], ['Reportes', 'Agregar centro de costo al libro de compras'],
    ['Reportes', 'Reporte de ventas por vendedor y mes'], ['Configuración', 'Agregar categoría Mantención al workspace'],
    ['Configuración', 'Cambiar quién puede abrir tickets en RRHH'], ['Plan y facturación', 'Consulta por cambio a plan Ultra'],
    ['Power BI', 'Tablero de margen por línea de producto']];
  -- Interno: [categoría, asunto]
  it text[][] := array[
    ['Accesos', 'Acceso al SharePoint de Comercial Andes'], ['Accesos', 'Permisos de administrador en el tenant de Viña Los Robles'],
    ['Accesos', 'Cuenta de GitHub para el repositorio de integraciones'], ['Accesos', 'Usuario de prueba en SAP Logística Sur'],
    ['Accesos', 'Restablecer MFA del celular nuevo'], ['Accesos', 'Acceso a Power BI Service del cliente'],
    ['Accesos', 'Llave de la oficina para el nuevo consultor'], ['Accesos', 'Quitar accesos de practicante que terminó'],
    ['Equipos', 'Docking station para el escritorio 3'], ['Equipos', 'Teclado del notebook con teclas pegadas'],
    ['Equipos', 'Celular corporativo para soporte en terreno'], ['Equipos', 'Disco externo para respaldos de clientes'],
    ['Equipos', 'Audífonos con micrófono para reuniones'], ['Equipos', 'Pantalla parpadea en la sala grande'],
    ['Equipos', 'Renovar notebook de más de 4 años'], ['Equipos', 'Router de la oficina se reinicia solo'],
    ['Administración', 'Pagar licencias de JetBrains'], ['Administración', 'Renovar seguro de los equipos'],
    ['Administración', 'Rendición de gastos de septiembre'], ['Administración', 'Cotizar coworking para reuniones con clientes'],
    ['Administración', 'Actualizar contrato de soporte con proveedor'], ['Administración', 'Comprar café y agua para la oficina'],
    ['Administración', 'Inscribir curso de certificación Azure'], ['Administración', 'Revisar boletas de honorarios pendientes'],
    ['Administración', 'Planificar vacaciones de diciembre']];
  internos uuid[];
  n int;
  k int;
  categoria text;
  quien uuid;
  agente uuid;
  campos jsonb;
  ultimo_cli bigint;
  ultimo_int bigint;
begin
  if fit is null or pg_temp.cat(cli, 'Incidentes') is null or pg_temp.cat(intw, 'Accesos') is null then
    raise exception 'Faltan los workspaces demo de Fractional IT: corre antes datos_prueba_fractional.sql';
  end if;
  yo := (select usuario_id from public.empresa_miembros
         where empresa_id = fit and rol = 'admin' and usuario_id::text not like 'de000000-%' order by creado_en limit 1);
  internos := array[yo, sofia, nicolas];

  for n in 1..50 loop
    -- ── Soporte a clientes ──
    k := 1 + (n * 7) % array_length(sc, 1);
    categoria := sc[k][1];
    quien := clientes[1 + n % 3];
    agente := case when categoria in ('Incidentes', 'Requerimientos') then sofia
                   when categoria in ('Integraciones', 'Reportes') then nicolas else yo end;
    campos := case
      when categoria in ('Incidentes', 'Requerimientos') then jsonb_build_array(
        jsonb_build_object('key', 'empresa', 'label', 'Empresa cliente', 'type', 'select', 'value', empresas[1 + n % 3]),
        jsonb_build_object('key', 'usuarios_afectados', 'label', 'Personas afectadas', 'type', 'number', 'value', (1 + n % 9)::text))
      when categoria in ('Integraciones', 'Reportes') then jsonb_build_array(
        jsonb_build_object('key', 'empresa', 'label', 'Empresa cliente', 'type', 'select', 'value', empresas[1 + n % 3]),
        jsonb_build_object('key', 'ambiente', 'label', 'Ambiente', 'type', 'select', 'value', case when n % 3 = 0 then 'Pruebas' else 'Producción' end))
      when categoria = 'Power BI' then jsonb_build_array(
        jsonb_build_object('key', 'tablero', 'label', 'Tablero o informe', 'type', 'text', 'value', 'Ventas diarias'))
      end;
    ultimo_cli := pg_temp.lote(cli, n, pg_temp.cat(cli, categoria), quien, agente, sc[k][2], campos, ultimo_cli, aviso_cli);

    -- ── Interno ── (quien abre no se atiende a sí mismo: si es la misma persona, lo atiende el owner o la supervisora)
    k := 1 + (n * 11) % array_length(it, 1);
    categoria := it[k][1];
    quien := internos[1 + n % 3];
    agente := case when quien = sofia then yo when n % 2 = 0 then sofia else yo end;
    if agente = quien then agente := sofia; end if;
    ultimo_int := pg_temp.lote(intw, n, pg_temp.cat(intw, categoria), quien, agente, it[k][2], null, ultimo_int, aviso_int);
  end loop;

  perform set_config('request.jwt.claims', '', false);
end $$;
