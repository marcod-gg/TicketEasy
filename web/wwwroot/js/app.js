// TicketEasy. La seguridad la aplica la base (RLS y triggers en supabase/migrations); esto es solo UI.
// El HTML que escriben las personas (descripción, mensajes, campos rich_text) se sanitiza con DOMPurify al guardar y al mostrar.
const byId = id => document.getElementById(id);
const cfg = byId('app').dataset;
const sb = supabase.createClient(cfg.url, cfg.key, { db: { schema: 'ticketeasy' } });
const nucleo = sb.schema('public');

// ── Modelo ──────────────────────────────────────────────────────────────
// Mismo mapa que private.te_transicion_valida: la base rechaza cualquier otro salto
const PASOS = {
  new: ['triaged'], triaged: ['in_progress'], in_progress: ['resolved', 'on_hold', 'escalated'], on_hold: ['in_progress', 'escalated'],
  resolved: ['closed', 'reopened'], reopened: ['in_progress'], escalated: ['triaged'], closed: [] };
const ACCION = { triaged: ['Clasificar', 'tag'], in_progress: ['Atender', 'play'], on_hold: ['Pausar', 'pause'], resolved: ['Marcar resuelto', 'check'],
  escalated: ['Escalar', 'arrow-fat-up'], closed: ['Cerrar ticket', 'lock-simple'], reopened: ['Reabrir', 'arrow-counter-clockwise'] };
const TIPOS = ['incident', 'request', 'question', 'problem'];
const PRIORIDADES = ['low', 'medium', 'high', 'urgent'];
const ROLES = ['owner', 'supervisor', 'agent'];
const TIPOS_CAMPO = ['text', 'textarea', 'rich_text', 'number', 'date', 'datetime', 'select', 'multiselect', 'checkbox', 'email', 'phone'];
const TEXTO = {
  new: 'Nuevo', triaged: 'Clasificado', in_progress: 'En curso', on_hold: 'En pausa', resolved: 'Resuelto', reopened: 'Reabierto', escalated: 'Escalado', closed: 'Cerrado',
  abiertos: 'Abiertos', low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente',
  incident: 'Incidente', request: 'Requerimiento', question: 'Consulta', problem: 'Problema',
  requester: 'Solicitante', agent: 'Agente', supervisor: 'Supervisor', owner: 'Owner',
  reply: 'Respuesta', internal_note: 'Nota interna', system: 'Cambio de estado', allow: 'Permitido', deny: 'Bloqueado',
  text: 'Texto', textarea: 'Texto largo', rich_text: 'Texto enriquecido', number: 'Número', date: 'Fecha', datetime: 'Fecha y hora',
  select: 'Lista', multiselect: 'Lista múltiple', checkbox: 'Casilla', email: 'Correo', phone: 'Teléfono' };
const TONO = { new: 'info', triaged: 'info', in_progress: 'info', on_hold: 'warn', reopened: 'warn', escalated: 'bad', resolved: 'ok', closed: 'muted',
  urgent: 'bad', high: 'warn', medium: 'info', low: 'muted', allow: 'ok', deny: 'bad' };
const SEG = { reply: 'chat-circle', internal_note: 'lock-simple', system: 'arrows-left-right' };

// ── Utilidades ──────────────────────────────────────────────────────────
function el(tag, { dataset, ...props } = {}, ...hijos) {
  const e = Object.assign(document.createElement(tag), props);
  Object.assign(e.dataset, dataset);
  e.append(...hijos.filter(h => h != null && h !== false));
  return e;
}
const icono = n => el('i', { className: `ph ph-${n}`, ariaHidden: 'true' });
const texto = v => TEXTO[v] ?? v ?? '';
const chip = (v, tono) => el('span', { className: `nx-chip k-${tono ?? TONO[v] ?? 'muted'}`, textContent: texto(v) });
const opcion = (value, textContent, selected) => el('option', { value, textContent, selected: !!selected });
const sel = (opts, v, props = {}) => el('select', { className: 'form-select', ...props }, ...opts.map(([id, t]) => opcion(id, t, id === (v ?? ''))));
const campo = (l, control, { full, hint } = {}) => el('label', { className: `nx-field ${full ? 'nx-field--full' : ''}` }, el('span', { textContent: l }), control, hint && el('small', { textContent: hint }));
const campoRo = (l, v) => el('div', { className: 'nx-field' }, el('span', { textContent: l }), el('p', { className: 'nx-ro', textContent: v }));
const errP = () => el('p', { className: 'nx-error', role: 'alert' });
const boton = (txt, ic, primario = true) => el('button', { type: 'button', className: `btn btn-sm ${primario ? 'btn-primary' : 'btn-outline-secondary'}` }, icono(ic), ` ${txt}`);
const sinTildes = s => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const seguro = html => DOMPurify.sanitize(html ?? '');
const rico = html => el('div', { className: 'nx-rich', innerHTML: seguro(html) });
const aHtml = s => s.split(/\n+/).map(l => `<p>${l.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</p>`).join('');
const leerLocal = k => { try { return localStorage.getItem(k); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { } };
function fecha(v) {
  const d = new Date(v);
  const o = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };
  if (d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
  return d.toLocaleString('es-CL', o);
}
function toast(txt, icon = 'check-circle') {
  const t = el('div', { className: 'nx-toast' }, icono(icon), el('span', { textContent: txt }));
  byId('toasts').append(t);
  setTimeout(() => t.remove(), 4000);
}
async function ocupado(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; }
}
// Editor de texto enriquecido (Quill). Quill pone su barra antes del contenedor, por eso va envuelto
function editor(placeholder, html) {
  const caja = el('div');
  const nodo = el('div', { className: 'nx-editor' }, caja);
  const q = new Quill(caja, { theme: 'snow', placeholder, modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'ordered' }, { list: 'bullet' }], ['link', 'blockquote', 'code-block'], ['clean']] } });
  if (html) q.clipboard.dangerouslyPasteHTML(seguro(html));
  return { nodo, q, vacio: () => !q.getText().trim(), html: () => seguro(q.getSemanticHTML()), limpiar: () => q.setContents([]) };
}

// ── Estado ──────────────────────────────────────────────────────────────
let yo = null, empresas = [], emp = null;
let gente = new Map(), wss = [], cats = [], campos = [], equipo = [], tickets = [];
let filtro = 'abiertos', filtroWs = '', pestaña = 'general', catSel = null;
const escribe = () => emp?.access === 'completo';
const nombre = id => id ? gente.get(id) ?? '—' : '—';
const ws = id => wss.find(w => w.id === id);
const cat = id => cats.find(c => c.id === id);
const ruta = id => cat(id)?.path.map(x => cat(x)?.name).join(' / ') ?? '';
const donde = t => [ws(t.workspace_id)?.name, ruta(t.category_id)].filter(Boolean).join(' · ');
const enEstado = (t, f) => !f || (f === 'abiertos' ? t.status !== 'closed' : t.status === f);
// Mismo cálculo que private.te_rol: el mejor rol que cubre esa categoría (solo para decidir qué mostrar)
function miRol(wsId, catId) {
  const camino = cat(catId)?.path ?? [];
  return ROLES.find(r => equipo.some(s => s.workspace_id === wsId && s.user_id === yo && s.role === r && (!s.category_id || camino.includes(s.category_id)))) ?? null;
}
const esEquipo = wsId => equipo.some(s => s.workspace_id === wsId && s.user_id === yo);
const administra = wsId => miRol(wsId, null) === 'owner' || emp.role === 'admin';
// Categorías del workspace en orden de árbol, con su profundidad
function arbol(wsId, soloActivas) {
  const hijas = padre => cats.filter(c => c.workspace_id === wsId && c.parent_id === padre && (!soloActivas || c.is_active)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const out = [];
  const bajar = (padre, n) => hijas(padre).forEach(c => { out.push([c, n]); bajar(c.id, n + 1); });
  bajar(null, 0);
  return out;
}
const opcionesCat = (wsId, ninguna, soloActivas = true) => [['', ninguna], ...arbol(wsId, soloActivas).map(([c, n]) => [c.id, `${' '.repeat(n)}${c.name}`])];
// Formulario vigente: el de la categoría más cercana hacia la raíz que tenga campos activos
function plantilla(catId) {
  for (const id of [...(cat(catId)?.path ?? [])].reverse()) {
    const fs = campos.filter(f => f.category_id === id && f.is_active).sort((a, b) => a.position - b.position);
    if (fs.length) return { origen: id, fs };
  }
  return { origen: null, fs: [] };
}

// ── Sesión y empresa ────────────────────────────────────────────────────
async function sesion() {
  const { data: { session } } = await sb.auth.getSession();
  yo = session?.user.id ?? null;
  empresas = [];
  if (session) {
    const { data, error } = await sb.rpc('my_companies');
    empresas = (data ?? []).filter(e => e.access);
    if (!empresas.length) {
      byId('loginMsg').textContent = error?.message
        ?? (data?.length ? 'El plan de TicketEasy de tu empresa no está vigente.' : 'Tu cuenta no pertenece a ninguna empresa con TicketEasy.');
      await sb.auth.signOut();
      return;
    }
  }
  const dentro = !!empresas.length;
  byId('login').hidden = dentro;
  byId('shell').hidden = !dentro;
  if (!dentro) return;
  byId('who').textContent = session.user.email;
  byId('empNombre').hidden = empresas.length > 1;
  byId('empSel').hidden = empresas.length < 2;
  byId('empSel').replaceChildren(...empresas.map(e => opcion(e.company_id, e.name)));
  await elegirEmpresa(empresas.find(e => e.company_id === leerLocal('empresa')) ?? empresas[0]);
}
async function elegirEmpresa(e) {
  emp = e;
  guardarLocal('empresa', e.company_id);
  byId('empSel').value = e.company_id;
  byId('empNombre').textContent = e.name;
  byId('lectura').hidden = escribe();
  filtroWs = '';
  await cargarCatalogo();
  navegar();
}
async function cargarCatalogo() {
  const [dir, w, c, f, s] = await Promise.all([
    sb.rpc('company_directory', { p_company: emp.company_id }),
    sb.from('workspaces').select('*').eq('company_id', emp.company_id).order('name'),
    sb.from('categories').select('*'),
    sb.from('form_fields').select('*'),
    sb.from('workspace_staff').select('*')]);
  gente = new Map((dir.data ?? []).map(p => [p.user_id, p.name]));
  wss = w.data ?? [];
  const idsWs = new Set(wss.map(x => x.id));
  cats = (c.data ?? []).filter(x => idsWs.has(x.workspace_id));
  const idsCat = new Set(cats.map(x => x.id));
  campos = (f.data ?? []).filter(x => idsCat.has(x.category_id));
  equipo = (s.data ?? []).filter(x => idsWs.has(x.workspace_id));
  pintarNav();
}
byId('empSel').onchange = e => elegirEmpresa(empresas.find(x => x.company_id === e.target.value));

byId('loginForm').onsubmit = async e => {
  e.preventDefault();
  byId('loginMsg').textContent = '';
  const { error } = await ocupado(byId('loginBtn'), () => sb.auth.signInWithPassword({ email: byId('email').value, password: byId('pass').value }));
  if (error) byId('loginMsg').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message;
  else sesion();
};
byId('logout').onclick = () => sb.auth.signOut();
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') sesion(); });

// ── Navegación (#/ · #/t/123 · #/ws/<id> · #/nuevo-ws) ──────────────────
function pintarNav() {
  const mios = wss.filter(w => administra(w.id));
  const crea = emp.role === 'admin' && escribe();
  byId('nav').replaceChildren(...[
    el('div', { className: 'nx-nav__group' }, el('a', { href: '#/', dataset: { v: 'tickets' } }, icono('ticket'), el('span', { textContent: 'Tickets' }))),
    (mios.length || crea) && el('div', { className: 'nx-nav__group' },
      el('p', { className: 'nx-nav__label', textContent: 'Workspaces' }),
      ...mios.map(w => el('a', { href: `#/ws/${w.id}`, dataset: { v: w.id } }, icono('gear-six'), el('span', { textContent: w.name }))),
      crea && el('a', { href: '#/nuevo-ws', dataset: { v: 'nuevo-ws' } }, icono('plus'), el('span', { textContent: 'Nuevo workspace' })))
  ].filter(Boolean));
}
window.onhashchange = navegar;
function navegar() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  const v = a === 'ws' && ws(b) && administra(b) ? b : a === 'nuevo-ws' && emp.role === 'admin' ? 'nuevo-ws' : 'tickets';
  document.querySelectorAll('#nav a').forEach(x => x.dataset.v === v ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'));
  byId('msg').textContent = '';
  if (v === 'nuevo-ws') return nuevoWorkspace();
  if (v !== 'tickets') return configurar(v);
  listado().then(() => { if (a === 't' && Number(b)) abrir(Number(b)); });
}
function cabecera(eyebrow, titulo, bajada, ...acciones) {
  byId('eyebrow').textContent = eyebrow;
  byId('titulo').textContent = titulo;
  byId('bajada').textContent = bajada ?? '';
  byId('acciones').replaceChildren(...acciones.filter(Boolean));
  document.title = `${titulo} · ${cfg.producto}`;
}

// ── Listado de tickets ──────────────────────────────────────────────────
async function listado() {
  const nuevoBtn = () => escribe() && wss.some(w => w.is_active) && el('button', { className: 'btn btn-primary', onclick: nuevoTicket }, icono('plus'), ' Nuevo ticket');
  cabecera(emp.name, 'Tickets', equipo.some(s => s.user_id === yo) ? 'Tus solicitudes y los tickets que atiendes, del último movimiento al más antiguo.' : 'Tus solicitudes y en qué van.', nuevoBtn());
  const c = byId('contenido');
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  // ponytail: tope de 1000 tickets con búsqueda en el navegador; paginar con .range() cuando crezca
  const { data, error } = await sb.from('tickets').select('*').eq('company_id', emp.company_id).order('updated_at', { ascending: false }).limit(1000);
  if (error) { c.replaceChildren(); byId('msg').textContent = error.message; return; }
  tickets = data;

  const buscar = el('input', { type: 'search', className: 'form-control', placeholder: 'Buscar por asunto, número o persona…', ariaLabel: 'Buscar' });
  const selWs = sel([['', 'Todos los workspaces'], ...wss.map(w => [w.id, w.name])], filtroWs, { ariaLabel: 'Workspace', style: 'max-width:240px' });
  const filtros = el('div', { className: 'nx-filters', role: 'group', ariaLabel: 'Filtrar por estado' });
  const tabla = el('div', { className: 'nx-panel' });
  const pintarFiltros = () => filtros.replaceChildren(...[null, 'abiertos', ...Object.keys(PASOS)].map(f => {
    const n = tickets.filter(t => enEstado(t, f) && (!filtroWs || t.workspace_id === filtroWs)).length;
    if (f && f !== 'abiertos' && !n && filtro !== f) return null;
    return el('button', { className: 'nx-filter', ariaPressed: String(filtro === f), onclick: () => { filtro = f; pintarFiltros(); pintar(); } },
      f ? texto(f) : 'Todos', el('span', { className: 'num', textContent: n }));
  }).filter(Boolean));
  selWs.onchange = () => { filtroWs = selWs.value; pintarFiltros(); pintar(); };
  buscar.oninput = pintar;
  c.replaceChildren(el('div', { className: 'nx-toolbar' }, el('label', { className: 'nx-search' }, icono('magnifying-glass'), buscar), wss.length > 1 && selWs, filtros), tabla);
  pintarFiltros();
  pintar();

  function pintar() {
    if (!tickets.length) {
      tabla.replaceChildren(el('div', { className: 'nx-empty' }, icono('ticket'), el('h3', { textContent: 'Aún no hay tickets' }),
        el('p', { textContent: wss.length ? 'Cuando alguien pida ayuda, aparecerá aquí.'
          : emp.role === 'admin' ? 'Crea el primer workspace para empezar a recibir solicitudes.' : 'Tu empresa todavía no tiene espacios de atención.' }),
        wss.length ? nuevoBtn() : emp.role === 'admin' && escribe() && el('a', { className: 'btn btn-primary', href: '#/nuevo-ws' }, icono('plus'), ' Nuevo workspace')));
      return;
    }
    const term = sinTildes(buscar.value.trim().replace(/^#/, ''));
    const vis = tickets.filter(t => enEstado(t, filtro) && (!filtroWs || t.workspace_id === filtroWs)
      && (!term || [String(t.id), t.subject, nombre(t.requester_id), nombre(t.assignee_id)].some(s => sinTildes(s).includes(term))));
    const cols = ['#', 'Asunto', 'Dónde', 'Estado', 'Prioridad', 'Solicitante', 'Asignado', 'Último movimiento'];
    tabla.replaceChildren(
      el('div', { className: 'table-responsive' }, el('table', { className: 'table nx-table' },
        el('thead', {}, el('tr', {}, ...cols.map(x => el('th', { textContent: x })))),
        el('tbody', {}, ...(vis.length ? vis.map(t => el('tr', { className: 'nx-row--link', onclick: e => { if (!e.target.closest('button')) abrir(t.id); } },
          el('td', { className: 'mono nx-faint', textContent: t.id }),
          el('td', {}, el('button', { className: 'nx-name', title: t.subject, textContent: t.subject, onclick: () => abrir(t.id) })),
          el('td', { className: 'nx-faint', textContent: donde(t) }),
          el('td', {}, chip(t.status)),
          el('td', {}, chip(t.priority)),
          el('td', { textContent: nombre(t.requester_id) }),
          el('td', { textContent: nombre(t.assignee_id) }),
          el('td', { className: 'num', textContent: fecha(t.updated_at) }))) :
          [el('tr', {}, el('td', { colSpan: cols.length, className: 'nx-loading', textContent: 'Nada coincide con el filtro.' }))])))),
      el('div', { className: 'nx-tablefoot num', textContent: `${vis.length} de ${tickets.length} tickets` }));
  }
}

// ── Diálogo ─────────────────────────────────────────────────────────────
const dlg = byId('dlg'), frm = byId('frm');
function dialogo(eyebrow, titulo, ancho, ...cuerpo) {
  dlg.classList.toggle('nx-dialog--wide', ancho);
  frm.onsubmit = e => e.preventDefault();
  frm.replaceChildren(el('div', { className: 'nx-dialog__head' }, el('p', { className: 'fi-eyebrow', textContent: eyebrow }), el('h2', { id: 'dlgTitulo', textContent: titulo })), ...cuerpo);
  if (!dlg.open) dlg.showModal();
}
const pie = (err, ...botones) => el('div', { className: 'nx-dialog__foot' }, err,
  el('button', { type: 'button', className: 'btn btn-outline-secondary', textContent: 'Cancelar', onclick: () => dlg.close() }), ...botones);
dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
dlg.addEventListener('close', () => { if (location.hash.startsWith('#/t/')) history.replaceState(null, '', '#/'); });

// ── Formularios dinámicos ───────────────────────────────────────────────
// Un campo de formulario de categoría: { f, nodo, valor(), error() }. Las opciones se guardan con su etiqueta para el historial
function campoDinamico(f) {
  const ops = (f.config.options ?? []).map(o => o.label ?? o);
  let control, valor, error = () => null;
  if (f.field_type === 'rich_text') {
    const ed = editor(f.placeholder ?? '');
    control = ed.nodo;
    valor = () => ed.vacio() ? null : ed.html();
    error = () => f.is_required && ed.vacio() ? `Completa «${f.label}».` : null;
  } else if (f.field_type === 'multiselect') {
    const cajas = ops.map(o => el('input', { type: 'checkbox', value: o, className: 'form-check-input' }));
    control = el('div', { className: 'nx-filters' }, ...cajas.map((c, i) => el('label', { className: 'nx-check' }, c, ops[i])));
    valor = () => { const v = cajas.filter(c => c.checked).map(c => c.value); return v.length ? v : null; };
    error = () => f.is_required && !valor() ? `Elige al menos una opción en «${f.label}».` : null;
  } else if (f.field_type === 'checkbox') {
    const c = el('input', { type: 'checkbox', className: 'form-check-input', required: f.is_required });
    control = el('label', { className: 'nx-check' }, c, f.placeholder || 'Sí');
    valor = () => c.checked;
  } else {
    control = f.field_type === 'select' ? sel([['', 'Elige…'], ...ops.map(o => [o, o])], '')
      : f.field_type === 'textarea' ? el('textarea', { className: 'form-control', rows: 3 })
      : el('input', { className: 'form-control', type: { number: 'number', date: 'date', datetime: 'datetime-local', email: 'email', phone: 'tel' }[f.field_type] ?? 'text', step: f.field_type === 'number' ? 'any' : undefined });
    control.required = f.is_required;
    if (f.placeholder && f.field_type !== 'select') control.placeholder = f.placeholder;
    valor = () => control.value.trim() || null;
  }
  const full = ['textarea', 'rich_text', 'multiselect'].includes(f.field_type);
  return { f, valor, error, nodo: el('div', { className: `nx-field ${full ? 'nx-field--full' : ''}` },
    el('span', {}, f.label, f.is_required ? el('em', { textContent: ' *', ariaHidden: 'true' }) : null), control, f.help_text && el('small', { textContent: f.help_text })) };
}
const verCampos = cf => cf.length ? el('dl', { className: 'nx-kv nx-field--full' }, ...cf.flatMap(x => [el('dt', { textContent: x.label }),
  el('dd', {}, x.type === 'rich_text' ? rico(x.value) : Array.isArray(x.value) ? x.value.join(', ') : typeof x.value === 'boolean' ? (x.value ? 'Sí' : 'No') : String(x.value))])) : null;

// ── Nuevo ticket ────────────────────────────────────────────────────────
function nuevoTicket() {
  const activos = wss.filter(w => w.is_active);
  const err = errP();
  const selWs = sel(activos.map(w => [w.id, w.name]), ws(filtroWs)?.is_active ? filtroWs : activos[0]?.id);
  const selCat = el('select', { className: 'form-select' });
  const selTipo = sel(TIPOS.map(x => [x, texto(x)]), 'incident');
  const selPrio = sel(PRIORIDADES.map(x => [x, texto(x)]), 'medium');
  const selPara = el('select', { className: 'form-select' });
  const campoPara = campo('A nombre de', selPara, { hint: 'Para solicitudes que llegan por teléfono o correo.' });
  const asunto = el('input', { className: 'form-control', required: true, minLength: 3, maxLength: 200, placeholder: 'Por ejemplo: no puedo emitir facturas en SAP' });
  const desc = editor('Qué pasa, desde cuándo y qué intentaste.');
  const extra = el('div', { className: 'nx-fields nx-field--full', style: 'padding:0' });
  let dinamicos = [];
  const alCambiarCat = () => {
    dinamicos = plantilla(selCat.value || null).fs.map(campoDinamico);
    extra.replaceChildren(...dinamicos.map(d => d.nodo));
  };
  const alCambiarWs = () => {
    selCat.replaceChildren(...opcionesCat(selWs.value, 'Sin categoría').map(([id, t]) => opcion(id, t)));
    campoPara.hidden = !esEquipo(selWs.value);
    selPara.replaceChildren(...[...gente].map(([id, n]) => opcion(id, id === yo ? `${n} (yo)` : n, id === yo)));
    alCambiarCat();
  };
  selWs.onchange = alCambiarWs;
  selCat.onchange = alCambiarCat;
  const crear = el('button', { className: 'btn btn-primary', textContent: 'Crear ticket' });
  dialogo('Mesa de ayuda', 'Nuevo ticket', false,
    el('div', { className: 'nx-fields' },
      campo('Workspace', selWs), campo('Categoría', selCat), campo('Tipo', selTipo), campo('Prioridad', selPrio), campoPara,
      campo('Asunto', asunto, { full: true }),
      el('div', { className: 'nx-field nx-field--full' }, el('span', {}, 'Descripción', el('em', { textContent: ' *', ariaHidden: 'true' })), desc.nodo),
      extra),
    pie(err, crear));
  alCambiarWs();
  asunto.focus();
  frm.onsubmit = async e => {
    e.preventDefault();
    err.textContent = '';
    if (!frm.reportValidity()) return;
    const falta = desc.vacio() ? 'Describe qué necesitas.' : dinamicos.map(d => d.error()).find(Boolean);
    if (falta) { err.textContent = falta; return; }
    const fila = {
      workspace_id: selWs.value, category_id: selCat.value || null, type: selTipo.value, priority: selPrio.value,
      subject: asunto.value.trim(), description: desc.html(),
      custom_fields: dinamicos.map(d => ({ key: d.f.key, label: d.f.label, type: d.f.field_type, value: d.valor() })).filter(x => x.value !== null) };
    if (!campoPara.hidden && selPara.value !== yo) fila.requester_id = selPara.value;
    const { data, error } = await ocupado(crear, () => sb.from('tickets').insert(fila).select('id').single());
    if (error) { err.textContent = error.code === '42501' ? 'No tienes acceso para abrir tickets en este workspace.' : error.message; return; }
    dlg.close();
    toast(`Ticket #${data.id} creado.`);
    await listado();
  };
}

// ── Detalle del ticket ──────────────────────────────────────────────────
async function abrir(id) {
  let t = tickets.find(x => x.id === id);
  if (!t) ({ data: t } = await sb.from('tickets').select('*').eq('id', id).eq('company_id', emp.company_id).maybeSingle());
  if (!t) { if (dlg.open) dlg.close(); toast(`No encontramos el ticket #${id}.`, 'warning-circle'); return; }
  history.replaceState(null, '', `#/t/${t.id}`);
  const rol = miRol(t.workspace_id, t.category_id);
  const err = errP();
  const datos = el('div', { className: 'nx-fields' },
    el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Descripción' }), rico(t.description)),
    verCampos(t.custom_fields),
    campoRo('Solicitante', nombre(t.requester_id)),
    campoRo('Creado', fecha(t.created_at)));
  if (rol && escribe()) datos.append(...gestion(t, err));
  else if (t.requester_id === yo && t.status === 'resolved' && escribe()) datos.append(confirmar(t, err));
  dlg.classList.add('nx-dialog--wide');
  frm.onsubmit = e => e.preventDefault();
  frm.replaceChildren(
    el('div', { className: 'nx-dialog__head' },
      el('p', { className: 'fi-eyebrow', textContent: `Ticket #${t.id} · ${donde(t)}` }),
      el('h2', { id: 'dlgTitulo', textContent: t.subject }),
      el('div', { className: 'nx-chips' }, chip(t.status), chip(t.priority), chip(t.type, 'muted'),
        t.assignee_id && el('span', { className: 'nx-chip k-muted', textContent: `Atiende ${nombre(t.assignee_id)}` }))),
    datos,
    hilo(t, rol),
    el('div', { className: 'nx-dialog__foot' }, err, el('button', { type: 'button', className: 'btn btn-outline-secondary', textContent: 'Volver', onclick: () => dlg.close() })));
  if (!dlg.open) dlg.showModal();
}
async function cambiar(t, cambios, err, ok) {
  err.textContent = '';
  const { error } = await sb.from('tickets').update(cambios).eq('id', t.id);
  if (error) { err.textContent = error.message; return; }
  toast(ok);
  await listado();
  abrir(t.id);
}

// Equipo: mover de estado y clasificar
function gestion(t, err) {
  const selCat = sel(opcionesCat(t.workspace_id, 'Sin categoría', false), t.category_id);
  const selPrio = sel(PRIORIDADES.map(x => [x, texto(x)]), t.priority);
  const selTipo = sel(TIPOS.map(x => [x, texto(x)]), t.type);
  const agentes = [...new Set(equipo.filter(s => s.workspace_id === t.workspace_id).map(s => s.user_id))];
  const selAsig = sel([['', 'Sin asignar'], ...agentes.map(u => [u, nombre(u)])], t.assignee_id);
  const pasos = PASOS[t.status];
  return [
    el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Mover a' }),
      pasos.length ? el('div', { className: 'nx-estados' }, ...pasos.map(s => el('button', {
        type: 'button', className: `btn btn-sm ${s === 'resolved' ? 'btn-primary' : 'btn-outline-secondary'}`,
        onclick: () => cambiar(t, { status: s }, err, `Ticket #${t.id}: ${texto(s).toLowerCase()}.`) }, icono(ACCION[s][1]), ` ${ACCION[s][0]}`)))
        : el('p', { className: 'nx-ro nx-faint', textContent: 'Ticket cerrado.' })),
    campo('Categoría', selCat), campo('Asignado', selAsig), campo('Prioridad', selPrio), campo('Tipo', selTipo),
    el('div', { className: 'nx-field nx-field--full' }, el('button', { type: 'button', className: 'btn btn-outline-secondary', onclick: () =>
      cambiar(t, { category_id: selCat.value || null, assignee_id: selAsig.value || null, priority: selPrio.value, type: selTipo.value }, err, 'Clasificación guardada.') },
      icono('floppy-disk'), ' Guardar clasificación'))];
}

// Solicitante: confirmar o rechazar la solución
function confirmar(t, err) {
  const motivo = el('textarea', { className: 'form-control', rows: 2, maxLength: 5000, placeholder: 'Si sigue fallando, cuéntanos qué pasa.', ariaLabel: 'Qué sigue fallando' });
  async function responder(aceptado, btn) {
    err.textContent = '';
    const { error } = await ocupado(btn, () => sb.rpc('respond_resolution', { p_ticket: t.id, p_accepted: aceptado, p_comment: motivo.value.trim() ? aHtml(motivo.value.trim()) : null }));
    if (error) { err.textContent = error.message; if (!aceptado) motivo.focus(); return; }
    toast(aceptado ? 'Gracias, cerramos el ticket.' : 'Reabrimos el ticket.');
    await listado();
    abrir(t.id);
  }
  const si = el('button', { type: 'button', className: 'btn btn-sm btn-primary', onclick: () => responder(true, si) }, icono('check'), ' Sí, cerrar ticket');
  const no = el('button', { type: 'button', className: 'btn btn-sm btn-outline-secondary', onclick: () => responder(false, no) }, icono('arrow-counter-clockwise'), ' No, sigue el problema');
  return el('div', { className: 'nx-confirma nx-field--full' },
    el('p', {}, el('b', { textContent: '¿Quedó resuelto? ' }), 'El equipo marcó este ticket como resuelto.'), motivo, el('div', {}, si, no));
}

// Conversación: respuestas, notas internas (solo equipo) y cambios de estado, con el rol de quien escribió
function hilo(t, rol) {
  const lista = el('ol', { className: 'nx-seg__list' }, el('li', { className: 'nx-loading', textContent: 'Cargando…' }));
  const cuenta = el('span', { className: 'nx-panel__aside' });
  let tipo = 'reply';
  const tipos = el('div', { className: 'nx-filters', role: 'group', ariaLabel: 'Tipo de mensaje' });
  const pintarTipos = () => tipos.replaceChildren(...['reply', 'internal_note'].map(k => el('button', {
    type: 'button', className: 'nx-filter', ariaPressed: String(tipo === k), onclick: () => { tipo = k; pintarTipos(); } }, icono(SEG[k]), texto(k))));
  pintarTipos();
  const ed = escribe() ? editor(rol ? 'Responde al solicitante o deja una nota para el equipo…' : 'Agrega información o responde al equipo…') : null;
  const err = errP();
  const btn = el('button', { type: 'button', className: 'btn btn-sm btn-primary' }, icono('paper-plane-right'), ' Enviar');

  async function cargar() {
    const { data, error } = await sb.from('ticket_messages').select('*').eq('ticket_id', t.id).order('created_at', { ascending: false });
    if (error) { lista.replaceChildren(el('li', { className: 'nx-error', textContent: error.message })); return; }
    cuenta.replaceChildren(el('b', { textContent: String(data.length) }), data.length === 1 ? ' registro' : ' registros');
    lista.replaceChildren(...(data.length ? data.map(m => el('li', { className: `nx-seg__item ${m.kind === 'internal_note' ? 'nx-seg__item--interna' : m.kind === 'system' ? 'nx-seg__item--sistema' : ''}` },
      el('span', { className: 'nx-item__icon' }, icono(SEG[m.kind])),
      el('div', {},
        el('p', { className: 'nx-seg__meta' }, el('b', { textContent: nombre(m.author_id) }), ` · ${texto(m.author_role)}`, m.kind === 'internal_note' && ' · nota interna',
          el('time', { dateTime: m.created_at, textContent: fecha(m.created_at) })),
        m.kind === 'system' ? el('p', { className: 'nx-seg__txt', textContent: m.body.split(' → ').map(texto).join(' → ') }) : rico(m.body)))) :
      [el('li', { className: 'nx-quiet nx-seg__empty' }, icono('chat-circle-dots'), 'Sin mensajes todavía.')]));
  }
  async function enviar() {
    err.textContent = '';
    if (ed.vacio()) { err.textContent = 'Escribe el mensaje antes de enviarlo.'; ed.q.focus(); return; }
    const { error } = await ocupado(btn, () => sb.from('ticket_messages').insert({ ticket_id: t.id, kind: rol ? tipo : 'reply', body: ed.html() }));
    if (error) { err.textContent = error.message; return; }
    ed.limpiar();
    await cargar();
  }
  btn.onclick = enviar;
  ed?.q.keyboard.addBinding({ key: 'Enter', shortKey: true }, () => { enviar(); return false; });
  cargar();
  return el('section', { className: 'nx-seg', ariaLabel: 'Conversación' },
    el('div', { className: 'nx-seg__head' }, el('p', { className: 'fi-eyebrow', textContent: 'Conversación' }), cuenta),
    ed ? el('div', { className: 'nx-seg__new' }, rol && tipos, ed.nodo,
      el('div', { className: 'nx-seg__actions' }, err, el('small', { className: 'nx-faint', textContent: 'Ctrl Enter para enviar' }), btn))
      : el('p', { className: 'nx-faint', textContent: 'Solo lectura: el plan de tu empresa está vencido.' }),
    lista);
}

// ── Administración de workspaces (owner o admin de la empresa) ──────────
const panel = (titulo, bajada, ...cuerpo) => el('section', { className: 'nx-panel' },
  el('div', { className: 'nx-panel__head' }, el('div', {}, el('h2', { textContent: titulo }), bajada && el('p', { className: 'nx-head__sub', textContent: bajada }))),
  el('div', { className: 'nx-panel__body' }, ...cuerpo));
// Ejecuta un cambio, avisa y vuelve a pintar con el catálogo al día
async function guardar(btn, err, accion, ok) {
  err.textContent = '';
  const res = await ocupado(btn, accion);
  const error = Array.isArray(res) ? res.find(r => r.error)?.error : res.error;
  if (error) { err.textContent = error.code === '42501' ? 'No tienes permiso para hacer este cambio.' : error.code === '23505' ? 'Eso ya existe.' : error.message; return; }
  toast(ok);
  await cargarCatalogo();
  navegar();
}
const quitar = (accion, err, ok) => {
  const b = el('button', { type: 'button', className: 'nx-act nx-act--danger', title: 'Quitar', ariaLabel: 'Quitar' }, icono('x'));
  b.onclick = () => guardar(b, err, accion, ok);
  return b;
};

function configurar(wsId) {
  const w = ws(wsId);
  cabecera('Workspace', w.name, w.is_active ? 'Categorías, formularios, equipo y quién puede abrir tickets.' : 'Inactivo: no recibe tickets nuevos.');
  const pestañas = [['general', 'General'], ['categorias', 'Categorías y formularios'], ['equipo', 'Equipo'], ['acceso', 'Acceso']];
  const cuerpo = el('div');
  const barra = el('div', { className: 'nx-filters nx-tabs', role: 'group', ariaLabel: 'Secciones del workspace' });
  const mostrar = () => ({ general: cfgGeneral, categorias: cfgCategorias, equipo: cfgEquipo, acceso: cfgAcceso })[pestaña](w, cuerpo);
  const pintar = () => barra.replaceChildren(...pestañas.map(([k, l]) => el('button', { className: 'nx-filter', ariaPressed: String(pestaña === k), onclick: () => { pestaña = k; pintar(); mostrar(); } }, l)));
  byId('contenido').replaceChildren(barra, cuerpo);
  pintar();
  mostrar();
}

function cfgGeneral(w, c) {
  const nombreIn = el('input', { className: 'form-control', value: w.name, required: true, minLength: 2, maxLength: 80 });
  const modo = sel([['open', 'Abierto: todos los miembros, menos la lista negra'], ['restricted', 'Restringido: solo la lista blanca']], w.access_mode);
  const activo = el('input', { type: 'checkbox', className: 'form-check-input', checked: w.is_active });
  const err = errP(), btn = boton('Guardar', 'floppy-disk');
  btn.onclick = () => nombreIn.reportValidity() && guardar(btn, err,
    () => sb.from('workspaces').update({ name: nombreIn.value.trim(), access_mode: modo.value, is_active: activo.checked }).eq('id', w.id), 'Workspace actualizado.');
  c.replaceChildren(panel('General', null,
    el('div', { className: 'nx-row' }, campo('Nombre', nombreIn), campo('Quién puede abrir tickets', modo)),
    el('label', { className: 'nx-check' }, activo, 'Activo: recibe tickets nuevos'),
    el('div', { className: 'nx-row' }, btn), err));
}

function cfgCategorias(w, c) {
  const nodos = arbol(w.id);
  if (cat(catSel)?.workspace_id !== w.id) catSel = nodos[0]?.[0].id ?? null;
  const nueva = el('input', { className: 'form-control form-control-sm', placeholder: 'Nueva categoría principal', maxLength: 80, ariaLabel: 'Nueva categoría principal' });
  const errA = errP(), btnA = boton('Agregar', 'plus');
  btnA.onclick = () => nueva.value.trim() && guardar(btnA, errA, () => sb.from('categories').insert({ workspace_id: w.id, name: nueva.value.trim() }), 'Categoría creada.');
  const lado = el('section', { className: 'nx-panel' },
    el('div', { className: 'nx-panel__head' }, el('h2', { textContent: 'Categorías' })),
    nodos.length ? el('ul', { className: 'nx-tree' }, ...nodos.map(([k, n]) => el('li', {}, el('button', {
      type: 'button', ariaCurrent: String(k.id === catSel), style: `padding-left:${10 + n * 18}px`, onclick: () => { catSel = k.id; cfgCategorias(w, c); } },
      icono(n ? 'arrow-elbow-down-right' : 'folder'), el('span', { className: k.is_active ? '' : 'is-off', textContent: k.name })))))
      : el('p', { className: 'nx-quiet', textContent: 'Aún no hay categorías.' }),
    el('div', { className: 'nx-panel__body' }, el('div', { className: 'nx-row' }, nueva, btnA), errA));
  c.replaceChildren(el('div', { className: 'nx-cfg' }, lado, catSel ? detalleCategoria(w, cat(catSel)) : el('div')));
}

function detalleCategoria(w, k) {
  const nombreIn = el('input', { className: 'form-control', value: k.name, maxLength: 80 });
  const activa = el('input', { type: 'checkbox', className: 'form-check-input', checked: k.is_active });
  const err = errP(), btn = boton('Guardar', 'floppy-disk');
  btn.onclick = () => nombreIn.value.trim() && guardar(btn, err, () => sb.from('categories').update({ name: nombreIn.value.trim(), is_active: activa.checked }).eq('id', k.id), 'Categoría actualizada.');
  const sub = el('input', { className: 'form-control form-control-sm', placeholder: `Nueva subcategoría de ${k.name}`, maxLength: 80, ariaLabel: 'Nueva subcategoría' });
  const errS = errP(), btnS = boton('Agregar', 'plus', false);
  btnS.onclick = () => sub.value.trim() && guardar(btnS, errS, () => sb.from('categories').insert({ workspace_id: w.id, parent_id: k.id, name: sub.value.trim() }), 'Subcategoría creada.');
  return el('div', { style: 'display:grid;gap:24px' },
    panel(ruta(k.id), 'Desactivarla deja de ofrecerla en tickets nuevos; los existentes la conservan.',
      el('div', { className: 'nx-row' }, campo('Nombre', nombreIn), el('label', { className: 'nx-check' }, activa, 'Activa'), btn), err,
      el('div', { className: 'nx-row' }, sub, btnS), errS),
    editorPlantilla(k));
}

// Editor de plantillas: la categoría usa la más cercana hacia la raíz; puede tener una propia o volver a heredar
function editorPlantilla(k) {
  const propios = campos.filter(f => f.category_id === k.id).sort((a, b) => a.position - b.position);
  const vigente = plantilla(k.id);
  const hereda = vigente.origen !== k.id;
  const err = errP();
  const siguiente = Math.max(-1, ...propios.map(f => f.position)) + 1;
  const copiar = boton('Crear propio a partir del heredado', 'copy', false);
  copiar.onclick = () => guardar(copiar, err, () => sb.from('form_fields').insert(vigente.fs.map(({ key, label, field_type, is_required, position, help_text, placeholder, config }) =>
    ({ category_id: k.id, key, label, field_type, is_required, position, help_text, placeholder, config }))), 'Formulario propio creado.');
  const heredar = boton('Volver a heredar', 'arrow-u-up-left', false);
  heredar.onclick = () => guardar(heredar, err, () => sb.from('form_fields').delete().eq('category_id', k.id), 'La categoría vuelve a heredar.');
  const agregar = boton('Agregar campo', 'plus');
  agregar.onclick = () => formCampo(k, null, siguiente);
  // Reordenar: se renumeran todos para no depender de posiciones repetidas
  const mover = (i, d) => {
    const orden = [...propios];
    [orden[i], orden[i + d]] = [orden[i + d], orden[i]];
    return () => Promise.all(orden.map((f, n) => sb.from('form_fields').update({ position: n }).eq('id', f.id)));
  };
  const accion = (ic, titulo, fn) => { const b = el('button', { type: 'button', className: 'nx-act', title: titulo, ariaLabel: titulo }, icono(ic)); b.onclick = () => fn(b); return b; };
  return el('div', { style: 'display:grid;gap:24px' },
    panel('Formulario', hereda
      ? (vigente.origen ? `Usa el formulario de «${ruta(vigente.origen)}».` : 'Usa el formulario del sistema: asunto, descripción, tipo y prioridad.')
      : 'Formulario propio de esta categoría. Se suma al del sistema (asunto, descripción, tipo y prioridad).',
      propios.length ? el('ul', { className: 'nx-lines' }, ...propios.map((f, i) => el('li', { className: 'nx-line' },
        el('div', { className: f.is_active ? '' : 'is-off' }, el('b', { textContent: f.label }),
          el('small', { textContent: [texto(f.field_type), f.is_required && 'obligatorio', !f.is_active && 'inactivo', f.key].filter(Boolean).join(' · ') })),
        el('span', { className: 'nx-rowact' },
          i > 0 && accion('arrow-up', 'Subir', b => guardar(b, err, mover(i, -1), 'Orden actualizado.')),
          i < propios.length - 1 && accion('arrow-down', 'Bajar', b => guardar(b, err, mover(i, 1), 'Orden actualizado.')),
          accion('pencil-simple', 'Editar', () => formCampo(k, f)),
          accion(f.is_active ? 'eye-slash' : 'eye', f.is_active ? 'Desactivar' : 'Activar',
            b => guardar(b, err, () => sb.from('form_fields').update({ is_active: !f.is_active }).eq('id', f.id), f.is_active ? 'Campo desactivado.' : 'Campo activado.'))))))
        : null,
      el('div', { className: 'nx-row' }, agregar, !propios.length && vigente.fs.length && copiar, propios.length && heredar), err),
    panel('Vista previa', 'Así verá el solicitante los campos de esta categoría, además de los del sistema.',
      vigente.fs.length ? el('div', { className: 'nx-preview nx-fields', style: 'padding:16px' }, ...vigente.fs.map(f => campoDinamico(f).nodo))
        : el('p', { className: 'nx-faint', textContent: 'Sin campos adicionales.' })));
}

function formCampo(k, f, pos) {
  const err = errP();
  const etiqueta = el('input', { className: 'form-control', required: true, maxLength: 120, value: f?.label ?? '' });
  const clave = el('input', { className: 'form-control mono', required: true, pattern: '[a-z][a-z0-9_]{0,49}', value: f?.key ?? '', disabled: !!f });
  if (!f) etiqueta.oninput = () => clave.value = sinTildes(etiqueta.value).replace(/[^a-z0-9]+/g, '_').replace(/^[_0-9]+|_+$/g, '').slice(0, 50);
  const tipo = sel(TIPOS_CAMPO.map(x => [x, texto(x)]), f?.field_type ?? 'text');
  const req = el('input', { type: 'checkbox', className: 'form-check-input', checked: !!f?.is_required });
  const ayuda = el('input', { className: 'form-control', maxLength: 500, value: f?.help_text ?? '' });
  const ejemplo = el('input', { className: 'form-control', maxLength: 200, value: f?.placeholder ?? '' });
  const opciones = el('textarea', { className: 'form-control', rows: 4, value: (f?.config.options ?? []).map(o => o.label ?? o).join('\n') });
  const campoOps = campo('Opciones', opciones, { full: true, hint: 'Una por línea.' });
  const verOps = () => campoOps.hidden = !['select', 'multiselect'].includes(tipo.value);
  tipo.onchange = verOps;
  const btn = el('button', { className: 'btn btn-primary', textContent: f ? 'Guardar campo' : 'Agregar campo' });
  dialogo(ruta(k.id), f ? `Editar «${f.label}»` : 'Nuevo campo', false,
    el('div', { className: 'nx-fields' },
      campo('Etiqueta', etiqueta), campo('Clave', clave, { hint: 'Identificador estable: no cambia después de crear el campo.' }),
      campo('Tipo', tipo), el('label', { className: 'nx-check' }, req, 'Obligatorio'),
      campo('Texto de ayuda', ayuda, { full: true }), campo('Ejemplo dentro del campo', ejemplo, { full: true }), campoOps),
    pie(err, btn));
  verOps();
  etiqueta.focus();
  frm.onsubmit = async e => {
    e.preventDefault();
    err.textContent = '';
    if (!frm.reportValidity()) return;
    const ops = opciones.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!campoOps.hidden && !ops.length) { err.textContent = 'Agrega al menos una opción.'; return; }
    const fila = { label: etiqueta.value.trim(), field_type: tipo.value, is_required: req.checked, help_text: ayuda.value.trim() || null, placeholder: ejemplo.value.trim() || null,
      config: campoOps.hidden ? {} : { options: ops.map(o => ({ value: o, label: o })) } };
    const { error } = await ocupado(btn, () => f ? sb.from('form_fields').update(fila).eq('id', f.id) : sb.from('form_fields').insert({ ...fila, category_id: k.id, key: clave.value, position: pos }));
    if (error) { err.textContent = error.code === '23505' ? 'Ya hay un campo con esa clave en esta categoría.' : error.message; return; }
    dlg.close();
    toast(f ? 'Campo guardado.' : 'Campo agregado.');
    await cargarCatalogo();
    navegar();
  };
}

function cfgEquipo(w, c) {
  const filas = equipo.filter(s => s.workspace_id === w.id)
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || nombre(a.user_id).localeCompare(nombre(b.user_id), 'es'));
  const err = errP();
  const persona = sel([['', 'Elige una persona…'], ...gente], '');
  const rol = sel(ROLES.map(r => [r, texto(r)]), 'agent');
  const alcance = sel(opcionesCat(w.id, 'Todo el workspace'), '');
  rol.onchange = () => { alcance.disabled = rol.value === 'owner'; if (alcance.disabled) alcance.value = ''; };
  const btn = boton('Agregar', 'user-plus');
  btn.onclick = () => persona.value && guardar(btn, err,
    () => sb.from('workspace_staff').insert({ workspace_id: w.id, user_id: persona.value, role: rol.value, category_id: alcance.value || null }), 'Equipo actualizado.');
  c.replaceChildren(panel('Equipo',
    'Owner: administra el workspace. Supervisor: gestiona los tickets de su alcance y apoya a los agentes. Agente: atiende su alcance, con todas sus subcategorías. Cada persona del equipo ocupa un cupo del plan.',
    filas.length ? el('ul', { className: 'nx-lines' }, ...filas.map(s => el('li', { className: 'nx-line' },
      el('div', {}, el('b', { textContent: nombre(s.user_id) }), el('small', { textContent: `${texto(s.role)} · ${s.category_id ? ruta(s.category_id) : 'Todo el workspace'}` })),
      quitar(() => sb.from('workspace_staff').delete().eq('id', s.id), err, 'Quitado del equipo.'))))
      : el('p', { className: 'nx-faint', textContent: 'Todavía no hay equipo. Agrega al menos un owner.' }),
    el('div', { className: 'nx-row' }, campo('Persona', persona), campo('Rol', rol), campo('Alcance', alcance), btn), err));
}

async function cfgAcceso(w, c) {
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  const [a, g] = await Promise.all([
    sb.from('workspace_access').select('*').eq('workspace_id', w.id),
    nucleo.from('grupos').select('id, nombre').eq('empresa_id', emp.company_id).order('nombre')]);
  if (pestaña !== 'acceso') return;
  const grupos = new Map((g.data ?? []).map(x => [x.id, x.nombre]));
  const err = errP();
  const quien = sel([['', 'Elige una persona o un grupo…'], ...[...grupos].map(([id, n]) => [`g:${id}`, `Grupo · ${n}`]), ...[...gente].map(([id, n]) => [`u:${id}`, n])], '');
  const tipo = sel([['allow', 'Permitir (lista blanca)'], ['deny', 'Bloquear (lista negra)']], w.access_mode === 'restricted' ? 'allow' : 'deny');
  const btn = boton('Agregar', 'plus');
  btn.onclick = () => {
    const [k, id] = quien.value.split(':');
    if (id) guardar(btn, err, () => sb.from('workspace_access').insert({ workspace_id: w.id, kind: tipo.value, [k === 'g' ? 'group_id' : 'user_id']: id }), 'Lista actualizada.');
  };
  const filas = a.data ?? [];
  c.replaceChildren(panel('Acceso', w.access_mode === 'open'
    ? 'Workspace abierto: todos los miembros de la empresa pueden abrir tickets, menos los bloqueados. Un bloqueo siempre gana.'
    : 'Workspace restringido: solo los permitidos pueden abrir tickets. Un bloqueo siempre gana. El equipo siempre tiene acceso.',
    filas.length ? el('ul', { className: 'nx-lines' }, ...filas.map(r => el('li', { className: 'nx-line' },
      el('div', {}, el('b', { textContent: r.user_id ? nombre(r.user_id) : `Grupo · ${grupos.get(r.group_id) ?? '—'}` }), ' ', chip(r.kind)),
      quitar(() => sb.from('workspace_access').delete().eq('id', r.id), err, 'Lista actualizada.'))))
      : el('p', { className: 'nx-faint', textContent: 'Sin reglas.' }),
    el('div', { className: 'nx-row' }, campo('Persona o grupo', quien), campo('Regla', tipo), btn), err));
}

function nuevoWorkspace() {
  cabecera(emp.name, 'Nuevo workspace', 'Un espacio de atención, por ejemplo TI, Personas o Finanzas. Después defines sus categorías, su equipo y quién puede abrir tickets.');
  const nombreIn = el('input', { className: 'form-control', required: true, minLength: 2, maxLength: 80, placeholder: 'TI' });
  const modo = sel([['open', 'Abierto: todos los miembros, menos la lista negra'], ['restricted', 'Restringido: solo la lista blanca']], 'open');
  const yoOwner = el('input', { type: 'checkbox', className: 'form-check-input', checked: true });
  const err = errP(), btn = boton('Crear workspace', 'plus');
  btn.onclick = async () => {
    if (!nombreIn.reportValidity()) return;
    err.textContent = '';
    const { data, error } = await ocupado(btn, () => sb.from('workspaces').insert({ company_id: emp.company_id, name: nombreIn.value.trim(), access_mode: modo.value }).select('id').single());
    if (error) { err.textContent = error.code === '23505' ? 'Ya existe un workspace con ese nombre.' : error.message; return; }
    if (yoOwner.checked) {
      const r = await sb.from('workspace_staff').insert({ workspace_id: data.id, user_id: yo, role: 'owner' });
      if (r.error) toast(r.error.message, 'warning-circle');
    }
    toast('Workspace creado.');
    await cargarCatalogo();
    pestaña = 'categorias';
    location.hash = `#/ws/${data.id}`;
  };
  byId('contenido').replaceChildren(panel('Datos', null,
    el('div', { className: 'nx-row' }, campo('Nombre', nombreIn), campo('Quién puede abrir tickets', modo)),
    el('label', { className: 'nx-check' }, yoOwner, 'Agregarme como owner (ocupa un cupo del plan)'),
    el('div', { className: 'nx-row' }, btn), err));
  nombreIn.focus();
}

sesion();
