// TicketEasy. La seguridad la aplica RLS (supabase/migrations, schema ticketeasy); esto es solo UI.
const byId = id => document.getElementById(id);
const cfg = byId('app').dataset;
const sb = supabase.createClient(cfg.url, cfg.key, { db: { schema: 'ticketeasy' } });

// ── Modelo ──────────────────────────────────────────────────────────────
// Mismo mapa que ticketeasy.transicion_valida: la base rechaza cualquier otro salto
const PASOS = {
  nuevo: ['clasificado'], clasificado: ['en_curso'], en_curso: ['resuelto', 'en_pausa', 'escalado'], en_pausa: ['en_curso', 'escalado'],
  resuelto: ['cerrado', 'reabierto'], reabierto: ['en_curso'], escalado: ['clasificado'], cerrado: [] };
const ACCION = { clasificado: ['Clasificar', 'tag'], en_curso: ['Atender', 'play'], en_pausa: ['Pausar', 'pause'], resuelto: ['Marcar resuelto', 'check'],
  escalado: ['Escalar', 'arrow-fat-up'], cerrado: ['Cerrar ticket', 'lock-simple'], reabierto: ['Reabrir', 'arrow-counter-clockwise'] };
const PRIORIDADES = ['baja', 'media', 'alta', 'urgente'];
const EQUIPO = ['agente', 'supervisor', 'admin'];
const TEXTO = { en_curso: 'En curso', en_pausa: 'En pausa', nota_interna: 'Nota interna', cambio_estado: 'Cambio de estado' };
const TONO = { nuevo: 'info', clasificado: 'info', en_curso: 'info', en_pausa: 'warn', reabierto: 'warn', escalado: 'bad', resuelto: 'ok', cerrado: 'muted',
  urgente: 'bad', alta: 'warn', media: 'info', baja: 'muted' };
const SEG = { comentario: 'chat-circle', nota_interna: 'lock-simple', cambio_estado: 'arrows-left-right' };

// ── Utilidades (las mismas del admin de Nexus) ──────────────────────────
function el(tag, { dataset, ...props } = {}, ...hijos) {
  const e = Object.assign(document.createElement(tag), props);
  Object.assign(e.dataset, dataset);
  e.append(...hijos.filter(h => h != null && h !== false));
  return e;
}
const icono = n => el('i', { className: `ph ph-${n}`, ariaHidden: 'true' });
const texto = v => TEXTO[v] ?? (v ? v[0].toUpperCase() + v.slice(1).replaceAll('_', ' ') : '');
const chip = v => el('span', { className: `nx-chip k-${TONO[v] ?? 'muted'}`, textContent: texto(v) });
const opcion = (value, textContent, selected) => el('option', { value, textContent, selected: !!selected });
const sinTildes = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
function fecha(v) {
  const d = new Date(v);
  const o = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleString('es-CL', o);
}
function toast(txt, icon) {
  const t = el('div', { className: 'nx-toast' }, icono(icon), el('span', { textContent: txt }));
  byId('toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}
const leerLocal = k => { try { return localStorage.getItem(k); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { } };

// ── Estado ──────────────────────────────────────────────────────────────
let yo = null, orgs = [], org = null, miembros = new Map(), areas = [], tickets = [], filtro = null;
const equipo = () => EQUIPO.includes(org?.rol);
const nombre = id => miembros.get(id)?.nombre ?? '—';
const area = id => areas.find(a => a.id === id)?.nombre ?? '—';

// ── Sesión y organización ───────────────────────────────────────────────
async function sesion() {
  const { data: { session } } = await sb.auth.getSession();
  yo = session?.user.id ?? null;
  orgs = [];
  if (session) {
    const { data, error } = await sb.from('miembros').select('rol, organizaciones(id, nombre)').eq('usuario_id', yo);
    orgs = (data ?? []).map(m => ({ ...m.organizaciones, rol: m.rol })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!orgs.length) {
      byId('loginMsg').textContent = error?.message ?? 'Tu cuenta no pertenece a ninguna organización. Pide acceso a tu administrador.';
      await sb.auth.signOut();
      return;
    }
  }
  byId('login').hidden = !!orgs.length;
  byId('shell').hidden = !orgs.length;
  if (!orgs.length) return;
  byId('who').textContent = session.user.email;
  byId('orgNombre').hidden = orgs.length > 1;
  byId('orgSel').hidden = orgs.length < 2;
  byId('orgSel').replaceChildren(...orgs.map(o => opcion(o.id, o.nombre)));
  await elegirOrg(orgs.find(o => o.id === leerLocal('org')) ?? orgs[0]);
}
async function elegirOrg(o) {
  org = o;
  guardarLocal('org', o.id);
  byId('orgSel').value = o.id;
  byId('orgNombre').textContent = o.nombre;
  const [m, a] = await Promise.all([
    sb.from('miembros').select('usuario_id, nombre, rol').eq('organizacion_id', o.id).order('nombre'),
    sb.from('areas').select('id, nombre, activa').eq('organizacion_id', o.id).order('nombre')]);
  miembros = new Map((m.data ?? []).map(x => [x.usuario_id, x]));
  areas = a.data ?? [];
  filtro = equipo() ? 'abiertos' : null;
  await listado();
  // Enlace directo a un ticket: …/#123
  const id = Number(location.hash.slice(1));
  if (id) abrir(id);
}
byId('orgSel').onchange = e => elegirOrg(orgs.find(o => o.id === e.target.value));

byId('loginForm').onsubmit = async e => {
  e.preventDefault();
  const btn = byId('loginBtn');
  byId('loginMsg').textContent = '';
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email: byId('email').value, password: byId('pass').value });
  btn.disabled = false;
  if (error) byId('loginMsg').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message;
  else sesion();
};
byId('logout').onclick = () => sb.auth.signOut();
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') sesion(); });

// ── Listado ─────────────────────────────────────────────────────────────
const pasa = (t, f) => !f || (f === 'abiertos' ? t.estado !== 'cerrado' : t.estado === f);

async function listado() {
  const titulo = equipo() ? 'Bandeja' : 'Mis tickets';
  byId('eyebrow').textContent = org.nombre;
  byId('titulo').textContent = titulo;
  byId('bajada').textContent = equipo() ? 'Los tickets de la organización, del último movimiento al más antiguo.' : 'Tus solicitudes y en qué van.';
  document.title = `${titulo} · ${cfg.producto}`;
  byId('msg').textContent = '';
  const c = byId('contenido');
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  // ponytail: tope de 1000 tickets con búsqueda en el navegador; paginar con .range() cuando crezca
  const { data, error } = await sb.from('tickets').select('*').eq('organizacion_id', org.id).order('actualizado_en', { ascending: false }).limit(1000);
  if (error) { c.replaceChildren(); byId('msg').textContent = error.message; return; }
  tickets = data;

  const buscar = el('input', { type: 'search', className: 'form-control', placeholder: 'Buscar por asunto, número o persona…', ariaLabel: 'Buscar' });
  const filtros = el('div', { className: 'nx-filters', role: 'group', ariaLabel: 'Filtrar por estado' });
  const tabla = el('div', { className: 'nx-panel' });
  const pintarFiltros = () => filtros.replaceChildren(...[null, 'abiertos', ...Object.keys(PASOS)].map(f => {
    const n = tickets.filter(t => pasa(t, f)).length;
    if (f && f !== 'abiertos' && !n && filtro !== f) return null;
    return el('button', { className: 'nx-filter', ariaPressed: String(filtro === f), onclick: () => { filtro = f; pintarFiltros(); pintar(); } },
      f ? texto(f) : 'Todos', el('span', { className: 'num', textContent: n }));
  }).filter(Boolean));
  c.replaceChildren(el('div', { className: 'nx-toolbar' }, el('label', { className: 'nx-search' }, icono('magnifying-glass'), buscar), filtros), tabla);
  buscar.oninput = pintar;
  pintarFiltros();
  pintar();

  function pintar() {
    if (!tickets.length) {
      tabla.replaceChildren(el('div', { className: 'nx-empty' }, icono('ticket'), el('h3', { textContent: 'Aún no hay tickets' }),
        el('p', { textContent: equipo() ? 'Cuando alguien pida ayuda, aparecerá aquí.' : 'Cuéntanos qué necesitas y sigue aquí cada avance.' }),
        el('button', { className: 'btn btn-primary', onclick: nuevo }, icono('plus'), ' Nuevo ticket')));
      return;
    }
    const term = sinTildes(buscar.value.trim().replace(/^#/, ''));
    const vis = tickets.filter(t => pasa(t, filtro) && (!term || [String(t.id), t.asunto, nombre(t.solicitante_id), nombre(t.agente_id)].some(s => sinTildes(s).includes(term))));
    const cols = ['#', 'Asunto', 'Estado', 'Prioridad', 'Área', equipo() && 'Solicitante', 'Agente', 'Último movimiento'].filter(Boolean);
    tabla.replaceChildren(
      el('div', { className: 'table-responsive' }, el('table', { className: 'table nx-table' },
        el('thead', {}, el('tr', {}, ...cols.map(x => el('th', { textContent: x })))),
        el('tbody', {}, ...(vis.length ? vis.map(t => el('tr', { className: 'nx-row--link', onclick: e => { if (!e.target.closest('button')) abrir(t.id); } },
          el('td', { className: 'mono nx-faint', textContent: t.id }),
          el('td', {}, el('button', { className: 'nx-name', title: t.asunto, textContent: t.asunto, onclick: () => abrir(t.id) })),
          el('td', {}, chip(t.estado)),
          el('td', {}, chip(t.prioridad)),
          el('td', { textContent: area(t.area_id) }),
          equipo() && el('td', { textContent: nombre(t.solicitante_id) }),
          el('td', { textContent: nombre(t.agente_id) }),
          el('td', { className: 'num', textContent: fecha(t.actualizado_en) }))) :
          [el('tr', {}, el('td', { colSpan: cols.length, className: 'nx-loading', textContent: 'Nada coincide con el filtro.' }))])))),
      el('div', { className: 'nx-tablefoot num', textContent: `${vis.length} de ${tickets.length} tickets` }));
  }
}

// ── Nuevo ticket ────────────────────────────────────────────────────────
const fn = byId('frmNuevo');
function nuevo() {
  fn.reset();
  fn.querySelector('.nx-error').textContent = '';
  fn.elements.area_id.replaceChildren(opcion('', 'No sé / otra'), ...areas.filter(a => a.activa).map(a => opcion(a.id, a.nombre)));
  fn.elements.prioridad.replaceChildren(...PRIORIDADES.map(p => opcion(p, texto(p), p === 'media')));
  byId('campoSolicitante').hidden = !equipo();
  fn.elements.solicitante_id.replaceChildren(...[...miembros.values()].map(m => opcion(m.usuario_id, m.usuario_id === yo ? `${m.nombre} (yo)` : m.nombre, m.usuario_id === yo)));
  byId('dlgNuevo').showModal();
  fn.elements.asunto.focus();
}
byId('btnNuevo').onclick = nuevo;
fn.onsubmit = async e => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(fn));
  const fila = { organizacion_id: org.id, asunto: d.asunto.trim(), descripcion: d.descripcion.trim(), prioridad: d.prioridad, area_id: d.area_id || null };
  if (equipo()) fila.solicitante_id = d.solicitante_id;
  e.submitter.disabled = true;
  const { data, error } = await sb.from('tickets').insert(fila).select('id').single();
  e.submitter.disabled = false;
  if (error) { fn.querySelector('.nx-error').textContent = error.code === '23514' ? 'Revisa el asunto (mínimo 3 letras) y la descripción.' : error.message; return; }
  byId('dlgNuevo').close();
  toast(`Ticket #${data.id} creado.`, 'check-circle');
  await listado();
};

// ── Detalle ─────────────────────────────────────────────────────────────
const dlg = byId('dlg'), frm = byId('frm');
const campoRo = (l, v, full) => el('div', { className: `nx-field ${full ? 'nx-field--full' : ''}` }, el('span', { textContent: l }), el('p', { className: 'nx-ro', textContent: v }));
const etiqueta = (l, control) => el('label', { className: 'nx-field' }, el('span', { textContent: l }), control);

async function abrir(id) {
  let t = tickets.find(x => x.id === id);
  if (!t) ({ data: t } = await sb.from('tickets').select('*').eq('id', id).eq('organizacion_id', org.id).maybeSingle());
  if (!t) { toast(`No encontramos el ticket #${id}.`, 'warning-circle'); history.replaceState(null, '', location.pathname); return; }
  history.replaceState(null, '', `#${t.id}`);
  const err = el('p', { className: 'nx-error', role: 'alert' });
  const datos = el('div', { className: 'nx-fields' },
    campoRo('Descripción', t.descripcion, true),
    campoRo('Solicitante', nombre(t.solicitante_id)),
    campoRo('Creado', fecha(t.creado_en)));
  if (equipo()) datos.append(...gestion(t, err));
  else if (t.estado === 'resuelto') datos.append(confirmar(t, err));
  frm.replaceChildren(
    el('div', { className: 'nx-dialog__head' },
      el('p', { className: 'fi-eyebrow', textContent: `Ticket #${t.id}${t.area_id ? ` · ${area(t.area_id)}` : ''}` }),
      el('h2', { id: 'dlgTitulo', textContent: t.asunto }),
      el('div', { className: 'nx-chips' }, chip(t.estado), chip(t.prioridad), t.agente_id && el('span', { className: 'nx-chip k-muted', textContent: `Atiende ${nombre(t.agente_id)}` }))),
    datos,
    hilo(t),
    el('div', { className: 'nx-dialog__foot' }, err, el('button', { type: 'button', className: 'btn btn-outline-secondary', textContent: 'Volver', onclick: () => dlg.close() })));
  if (!dlg.open) dlg.showModal();
}
dlg.onclose = () => history.replaceState(null, '', location.pathname + location.search);

async function cambiar(t, cambios, err, ok) {
  err.textContent = '';
  const { error } = await sb.from('tickets').update(cambios).eq('id', t.id);
  if (error) { err.textContent = error.message; return; }
  toast(ok, 'check-circle');
  await listado();
  abrir(t.id);
}

// Equipo: mover de estado y clasificar
function gestion(t, err) {
  const sel = (opts, v) => el('select', { className: 'form-select' }, ...opts.map(([id, txt]) => opcion(id, txt, id === (v ?? ''))));
  const selArea = sel([['', 'Sin área'], ...areas.filter(a => a.activa || a.id === t.area_id).map(a => [a.id, a.nombre])], t.area_id);
  const selPrio = sel(PRIORIDADES.map(p => [p, texto(p)]), t.prioridad);
  const selAgente = sel([['', 'Sin asignar'], ...[...miembros.values()].filter(m => EQUIPO.includes(m.rol)).map(m => [m.usuario_id, m.nombre])], t.agente_id);
  const pasos = PASOS[t.estado];
  return [
    el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Mover a' }),
      pasos.length ? el('div', { className: 'nx-estados' }, ...pasos.map(s => el('button', {
        type: 'button', className: `btn btn-sm ${s === 'resuelto' ? 'btn-primary' : 'btn-outline-secondary'}`,
        onclick: () => cambiar(t, { estado: s }, err, `Ticket #${t.id}: ${texto(s).toLowerCase()}.`) }, icono(ACCION[s][1]), ` ${ACCION[s][0]}`)))
        : el('p', { className: 'nx-ro nx-faint', textContent: 'Ticket cerrado.' })),
    etiqueta('Área', selArea), etiqueta('Prioridad', selPrio), etiqueta('Agente', selAgente),
    el('div', { className: 'nx-field' }, el('span', { innerHTML: '&nbsp;' }),
      el('button', { type: 'button', className: 'btn btn-outline-secondary', onclick: () => cambiar(t, { area_id: selArea.value || null, prioridad: selPrio.value, agente_id: selAgente.value || null }, err, 'Clasificación guardada.') },
        icono('floppy-disk'), ' Guardar clasificación'))];
}

// Solicitante: confirmar o rechazar la solución
function confirmar(t, err) {
  const motivo = el('textarea', { className: 'form-control', rows: 2, maxLength: 5000, placeholder: 'Si sigue fallando, cuéntanos qué pasa.', ariaLabel: 'Qué sigue fallando' });
  async function responder(conforme) {
    err.textContent = '';
    const { error } = await sb.rpc('responder_solucion', { p_ticket: t.id, p_conforme: conforme, p_comentario: motivo.value.trim() || null });
    if (error) { err.textContent = error.message; if (!conforme) motivo.focus(); return; }
    toast(conforme ? 'Gracias, cerramos el ticket.' : 'Reabrimos el ticket.', 'check-circle');
    await listado();
    abrir(t.id);
  }
  return el('div', { className: 'nx-confirma nx-field--full' },
    el('p', {}, el('b', { textContent: '¿Quedó resuelto? ' }), 'El equipo marcó este ticket como resuelto.'),
    motivo,
    el('div', {},
      el('button', { type: 'button', className: 'btn btn-sm btn-primary', onclick: () => responder(true) }, icono('check'), ' Sí, cerrar ticket'),
      el('button', { type: 'button', className: 'btn btn-sm btn-outline-secondary', onclick: () => responder(false) }, icono('arrow-counter-clockwise'), ' No, sigue el problema')));
}

// Conversación: respuestas, notas internas (solo equipo) y cambios de estado
function hilo(t) {
  const lista = el('ol', { className: 'nx-seg__list' }, el('li', { className: 'nx-loading', textContent: 'Cargando…' }));
  const cuenta = el('span', { className: 'nx-panel__aside' });
  let tipo = 'comentario';
  const tipos = el('div', { className: 'nx-filters', role: 'group', ariaLabel: 'Tipo de mensaje' });
  const pintarTipos = () => tipos.replaceChildren(...['comentario', 'nota_interna'].map(k => el('button', {
    type: 'button', className: 'nx-filter', ariaPressed: String(tipo === k), onclick: () => { tipo = k; pintarTipos(); } }, icono(SEG[k]), k === 'comentario' ? 'Respuesta' : 'Nota interna')));
  pintarTipos();
  const nota = el('textarea', { className: 'form-control', rows: 3, maxLength: 5000, ariaLabel: 'Nuevo mensaje',
    placeholder: `${equipo() ? 'Responde al solicitante o deja una nota para el equipo…' : 'Agrega información o responde al equipo…'}  (Ctrl Enter para enviar)` });
  const err = el('p', { className: 'nx-error', role: 'alert' });
  const btn = el('button', { type: 'button', className: 'btn btn-sm btn-primary' }, icono('paper-plane-right'), ' Enviar');

  async function cargar() {
    const { data, error } = await sb.from('seguimientos').select('*').eq('ticket_id', t.id).order('creado_en', { ascending: false });
    if (error) { lista.replaceChildren(el('li', { className: 'nx-error', textContent: error.message })); return; }
    cuenta.replaceChildren(el('b', { textContent: String(data.length) }), data.length === 1 ? ' registro' : ' registros');
    lista.replaceChildren(...(data.length ? data.map(s => el('li', { className: `nx-seg__item ${s.tipo === 'nota_interna' ? 'nx-seg__item--interna' : s.tipo === 'cambio_estado' ? 'nx-seg__item--sistema' : ''}` },
      el('span', { className: 'nx-item__icon' }, icono(SEG[s.tipo])),
      el('div', {},
        el('p', { className: 'nx-seg__meta' }, el('b', { textContent: texto(s.tipo) }), ` · ${nombre(s.autor_id)}`, el('time', { dateTime: s.creado_en, textContent: fecha(s.creado_en) })),
        el('p', { className: 'nx-seg__txt', textContent: s.tipo === 'cambio_estado' ? s.texto.split(' → ').map(texto).join(' → ') : s.texto })))) :
      [el('li', { className: 'nx-quiet nx-seg__empty' }, icono('chat-circle-dots'), 'Sin mensajes todavía.')]));
  }
  async function enviar() {
    const txt = nota.value.trim();
    err.textContent = '';
    if (!txt) { err.textContent = 'Escribe el mensaje antes de enviarlo.'; nota.focus(); return; }
    btn.disabled = true;
    const { error } = await sb.from('seguimientos').insert({ ticket_id: t.id, tipo, texto: txt });
    btn.disabled = false;
    if (error) { err.textContent = error.message; return; }
    nota.value = '';
    await cargar();
  }
  btn.onclick = enviar;
  nota.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); } };
  cargar();
  return el('section', { className: 'nx-seg', ariaLabel: 'Conversación' },
    el('div', { className: 'nx-seg__head' }, el('p', { className: 'fi-eyebrow', textContent: 'Conversación' }), cuenta),
    el('div', { className: 'nx-seg__new' }, equipo() && tipos, nota, el('div', { className: 'nx-seg__actions' }, err, btn)),
    lista);
}

// ── Diálogos ────────────────────────────────────────────────────────────
for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', e => { if (e.target === d) d.close(); });
for (const b of document.querySelectorAll('[data-cerrar]')) b.onclick = () => b.closest('dialog').close();

sesion();
