// TicketEasy. La seguridad la aplica la base (RLS y triggers en supabase/migrations); esto es solo UI.
// El HTML que escriben las personas (descripción, mensajes, campos rich_text) se sanitiza con DOMPurify al guardar y al mostrar.
const byId = id => document.getElementById(id);
const cfg = byId('app').dataset;
const sb = supabase.createClient(cfg.url, cfg.key, { db: { schema: 'ticketeasy' } });
const nucleo = sb.schema('public');

// ── Modelo ──────────────────────────────────────────────────────────────
// Mismo mapa que private.te_transicion_valida: la base rechaza cualquier otro salto
const PASOS = {
  new: ['triaged', 'cancelled'], triaged: ['in_progress', 'cancelled'], in_progress: ['resolved', 'pending_requester', 'on_hold', 'escalated', 'cancelled'],
  on_hold: ['in_progress', 'escalated', 'cancelled'], pending_requester: ['in_progress', 'cancelled'], resolved: ['closed', 'reopened'], reopened: ['in_progress', 'cancelled'],
  escalated: ['triaged', 'cancelled'], closed: [], cancelled: [] };
const ACCION = { triaged: ['Clasificar', 'tag'], in_progress: ['Atender', 'play'], on_hold: ['Esperar a un tercero', 'hourglass-medium'], resolved: ['Marcar resuelto', 'check'],
  escalated: ['Escalar', 'arrow-fat-up'], closed: ['Cerrar ticket', 'lock-simple'], reopened: ['Reabrir', 'arrow-counter-clockwise'], cancelled: ['Cancelar ticket', 'prohibit'],
  pending_requester: ['Pedir información', 'chat-circle-dots'] };
const TIPOS = ['incident', 'request', 'question', 'problem'];
const PRIORIDADES = ['low', 'medium', 'high', 'urgent'];
const ROLES = ['owner', 'supervisor', 'agent'];
const TIPOS_CAMPO = ['text', 'textarea', 'rich_text', 'number', 'date', 'datetime', 'select', 'multiselect', 'checkbox', 'email', 'phone'];
const TEXTO = {
  new: 'Nuevo', triaged: 'Clasificado', in_progress: 'En curso', on_hold: 'En espera de terceros', resolved: 'Resuelto', reopened: 'Reabierto', escalated: 'Escalado', closed: 'Cerrado', cancelled: 'Cancelado', pending_requester: 'Pendiente de respuesta',
  duplicate: 'Duplicado', not_applicable: 'No corresponde', announcement: 'Ya informado en un comunicado', withdrawn: 'El solicitante ya no lo necesita', other: 'Otro', no_response: 'Sin respuesta del solicitante',
  abiertos: 'Abiertos', mios: 'Asignados a mí', sin_asignar: 'Sin asignar', low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente',
  incident: 'Incidente', request: 'Requerimiento', question: 'Consulta', problem: 'Problema',
  requester: 'Solicitante', agent: 'Agente', supervisor: 'Supervisor', owner: 'Owner',
  info: 'Información', warning: 'Advertencia', danger: 'Crítico',
  reply: 'Respuesta', internal_note: 'Nota interna', system: 'Cambio de estado', allow: 'Permitido', deny: 'Bloqueado',
  text: 'Texto', textarea: 'Texto largo', rich_text: 'Texto enriquecido', number: 'Número', date: 'Fecha', datetime: 'Fecha y hora',
  select: 'Lista', multiselect: 'Lista múltiple', checkbox: 'Casilla', email: 'Correo', phone: 'Teléfono' };
const TONO = { new: 'info', triaged: 'info', in_progress: 'info', on_hold: 'warn', reopened: 'warn', escalated: 'bad', resolved: 'ok', closed: 'muted', cancelled: 'muted', pending_requester: 'warn',
  urgent: 'bad', high: 'warn', medium: 'info', low: 'muted', allow: 'ok', deny: 'bad', info: 'info', warning: 'warn', danger: 'bad' };
const ICONO_AVISO = { info: 'info', warning: 'warning', danger: 'warning-octagon' };
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

// Insignia: logo, o la inicial (workspaces) o el isotipo Fractional IT (empresas) si no hay
const insignia = (logo, nombre, empresa) => logo
  ? el('span', { className: 'nx-badge' }, el('img', { src: logo, alt: '' }))
  : empresa ? el('span', { className: 'nx-badge' }, el('span', { className: 'fi-brand-mark', ariaHidden: 'true' }))
  : el('span', { className: 'nx-badge nx-badge--ini', ariaHidden: 'true', textContent: (nombre ?? '?').trim().charAt(0).toUpperCase() });
const conInsignia = (cls, it) => el('span', { className: cls }, insignia(it?.logo, it?.name, it?.empresa), el('span', { textContent: it?.name ?? '' }));
// Selector con logo (un <select> no muestra imágenes). Se usa como un select: .value, .onchange y evento change.
// items: [{ id, name, logo, empresa }]
// Ubica un popover junto a su botón: debajo si cabe, si no arriba; siempre dentro de la ventana
// ponytail: posición calculada al abrir; usar CSS anchor positioning cuando todos los navegadores lo tengan
function ubicar(pop, btn) {
  const r = btn.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
  const abajo = r.bottom + 4 + h <= innerHeight - 8;
  Object.assign(pop.style, { left: `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`, top: `${abajo ? r.bottom + 4 : Math.max(8, r.top - h - 4)}px` });
}
function picker(items, valor, props = {}) {
  const btn = el('button', { type: 'button', className: 'form-select nx-pick__btn', ariaHasPopup: 'listbox', ...props });
  const pop = el('div', { popover: 'auto', className: 'nx-pick__pop', role: 'listbox' });
  const nodo = el('div', { className: 'nx-pick' }, btn, pop);
  btn.popoverTargetElement = pop;
  pop.addEventListener('toggle', e => {
    if (e.newState !== 'open') return;
    pop.style.minWidth = `${btn.getBoundingClientRect().width}px`;
    ubicar(pop, btn);
    pop.querySelector('[aria-selected="true"]')?.focus();
  });
  const pintar = () => {
    const it = items.find(i => i.id === nodo.value);
    btn.replaceChildren(insignia(it?.logo, it?.nuevo ? '+' : it?.name, it?.empresa), el('span', { textContent: it?.name ?? '' }));
    pop.replaceChildren(...items.map(i => el('button', { type: 'button', role: 'option', className: 'nx-pick__opt', ariaSelected: String(i.id === nodo.value),
      onclick: () => { pop.hidePopover(); if (i.id === nodo.value) return; nodo.value = i.id; pintar(); nodo.dispatchEvent(new Event('change')); } },
      insignia(i.logo, i.nuevo ? '+' : i.name, i.empresa), el('span', { textContent: i.name }))));
  };
  nodo.value = valor ?? items[0]?.id;
  pintar();
  return nodo;
}
const itemWs = w => ({ id: w.id, name: w.name, logo: w.logo_url });

// ── Estado ──────────────────────────────────────────────────────────────
let yo = null, empresas = [], emp = null;
let gente = new Map(), wss = [], cats = [], campos = [], equipo = [], tickets = [];
let filtro = null, pestaña = 'general', subAdmin = 'horario', catSel = null;
let wsAct = null;   // workspace elegido en la barra lateral: filtra todo lo que se ve
const escribe = () => emp?.access === 'completo';
const nombre = id => id ? gente.get(id) ?? '—' : '—';
const ws = id => wss.find(w => w.id === id);
const cat = id => cats.find(c => c.id === id);
const ruta = id => cat(id)?.path.map(x => cat(x)?.name).join(' / ') ?? '';
const donde = t => [ws(t.workspace_id)?.name, ruta(t.category_id)].filter(Boolean).join(' · ');
// Filtros: un estado, 'abiertos', o (en Tickets del equipo) 'mios' y 'sin_asignar', ambos solo entre los abiertos
const FINALES = ['closed', 'cancelled'];
const enEstado = (t, f) => !f || (f === 'abiertos' ? !FINALES.includes(t.status)
  : f === 'mios' ? !FINALES.includes(t.status) && t.assignee_id === yo
  : f === 'sin_asignar' ? !FINALES.includes(t.status) && !t.assignee_id
  : t.status === f);
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

// ── Marca de la empresa (public.empresas.marca) ─────────────────────────
// Sobrescribe solo los tokens de acento y tinta; el resto de tokens.css queda igual. Lo que falta usa la marca por defecto
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mezcla = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const hex = c => '#' + c.map(x => x.toString(16).padStart(2, '0')).join('');
const luz = c => c.map(x => x / 255).map(x => x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0);
function aplicarMarca(m) {
  m ??= {};
  let css = '';
  if (m.primario) {
    const p = rgb(m.primario), blanco = [255, 255, 255], negro = [0, 0, 0];
    const tema = (c, hover, sobre) => `--fi-accent:${hex(c)};--fi-accent-hover:${hex(hover)};--fi-on-accent:${sobre};--bs-primary-rgb:${c};--bs-link-color-rgb:${c};`;
    const claro = mezcla(p, blanco, .45), oscuro = mezcla(p, blanco, .25);
    css += `:root[data-marca]{${tema(p, mezcla(p, negro, .18), luz(p) > .4 ? '#171310' : '#fffaf5')}--fi-accent-light:${hex(claro)};}`;
    const dark = tema(oscuro, mezcla(oscuro, blanco, .2), luz(oscuro) > .4 ? '#1a0f09' : '#fffaf5');
    css += `@media (prefers-color-scheme: dark){:root[data-marca]:not([data-theme="light"]){${dark}}}:root[data-marca][data-theme="dark"]{${dark}}`;
  }
  if (m.oscuro) {
    const d = rgb(m.oscuro);
    css += `:root[data-marca]{--fi-dark:${m.oscuro};--fi-dark-2:${hex(mezcla(d, [255, 255, 255], .06))};}`;
  }
  const estilo = byId('marcaCss') ?? document.head.appendChild(el('style', { id: 'marcaCss' }));
  estilo.textContent = css;
  document.documentElement.toggleAttribute('data-marca', !!css);
}

// ── Sesión y empresa ────────────────────────────────────────────────────
async function sesion() {
  salirComo(true);
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
  if (!dentro) { if (canal) { sb.removeChannel(canal); canal = null; } return; }
  escucharNotifs();
  byId('who').textContent = session.user.email;
  await elegirEmpresa(empresas.find(e => e.company_id === leerLocal('empresa')) ?? empresas[0]);
}
async function elegirEmpresa(e) {
  salirComo(true);
  emp = e;
  guardarLocal('empresa', e.company_id);
  // Una empresa: logo y nombre. Varias: selector con logo y nombre de cada una
  const items = empresas.map(x => ({ id: x.company_id, name: x.name, logo: x.brand?.logo_url, empresa: true }));
  let actual = conInsignia('nx-pick__cur', items.find(i => i.id === e.company_id));
  if (items.length > 1) {
    actual = picker(items, e.company_id, { ariaLabel: 'Empresa' });
    actual.onchange = () => elegirEmpresa(empresas.find(x => x.company_id === actual.value));
  }
  byId('empSel').replaceChildren(actual);
  byId('lectura').hidden = escribe();
  await cargarCatalogo();
  cargarNotifs();
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
  wsAct = (ws(wsAct) ?? ws(leerLocal(`ws:${emp.company_id}`)) ?? wss.find(x => x.is_active) ?? wss[0])?.id ?? null;
  pintarWs();
  const idsWs = new Set(wss.map(x => x.id));
  cats = (c.data ?? []).filter(x => idsWs.has(x.workspace_id));
  const idsCat = new Set(cats.map(x => x.id));
  campos = (f.data ?? []).filter(x => idsCat.has(x.category_id));
  equipo = (s.data ?? []).filter(x => idsWs.has(x.workspace_id));
  pintarNav();
}

byId('loginForm').onsubmit = async e => {
  e.preventDefault();
  byId('loginMsg').textContent = '';
  const { error } = await ocupado(byId('loginBtn'), () => sb.auth.signInWithPassword({ email: byId('email').value, password: byId('pass').value }));
  if (error) byId('loginMsg').textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message;
  else sesion();
};
byId('logout').onclick = () => sb.auth.signOut();
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') sesion(); });

// ── Navegación (#/ · #/tickets · #/gestion[/comunicados] · #/admin[/marca] · #/nuevo-ws · #/ws/<sección> · #/t/123) ──
// Todo, menos Administración, es del workspace elegido en la barra lateral (wsAct)
// Inicio: resumen. Tickets: mis solicitudes. Gestión: lo que atiendo (equipo). Administración: la empresa (admin).
// Configuración del workspace: owner del workspace o admin de la empresa
let vista = 'inicio';   // la vista de tickets que queda detrás del detalle (#/t/123)
const atiende = () => esEquipo(wsAct);
// Mismo criterio que private.te_publica: owner o supervisor de todo el workspace, o admin de la empresa
const publica = wsId => ['owner', 'supervisor'].includes(miRol(wsId, null)) || emp.role === 'admin';
let subGestion = 'tickets';   // pestaña de Gestión: 'tickets' | 'comunicados'
// Selector de workspace bajo la empresa. Uno solo: logo y nombre; ninguno: nada
// El admin de la empresa crea workspaces desde la última opción del selector
const NUEVO_WS = '__nuevo';
function pintarWs() {
  const crea = emp.role === 'admin' && escribe() && wss.length > 0;
  const items = [...wss.map(itemWs), ...(crea ? [{ id: NUEVO_WS, name: 'Nuevo workspace', nuevo: true }] : [])];
  let nodo = items.length === 1 ? conInsignia('nx-pick__cur', items[0]) : null;
  if (items.length > 1) {
    nodo = picker(items, wsAct, { ariaLabel: 'Workspace' });
    nodo.onchange = () => {
      if (nodo.value === NUEVO_WS) { pintarWs(); hayCupoWorkspace().then(ok => { if (ok) location.hash = '#/nuevo-ws'; }); return; }
      salirComo(true); elegirWs(nodo.value); navegar();
    };
  }
  byId('wsSel').replaceChildren(...[nodo].filter(Boolean));
}
function elegirWs(id) {
  wsAct = id;
  guardarLocal(`ws:${emp.company_id}`, id);
  pintarWs();
  pintarNav();
}
const SECCIONES_WS = [['general', 'General'], ['categorias', 'Categorías y formularios'], ['equipo', 'Equipo'], ['feriados', 'Feriados'], ['acceso', 'Acceso']];
// Grupos colapsables (<details>): se abren solos cuando una de sus secciones es la actual
function pintarNav() {
  const item = (v, href, ic, txt) => el('a', { href, dataset: { v } }, icono(ic), el('span', { textContent: txt }));
  const grupo = (ic, txt, hijos) => {
    hijos = hijos.filter(Boolean);
    if (!hijos.length) return null;
    return el('details', { className: 'nx-nav__sub' }, el('summary', {}, icono(ic), el('span', { textContent: txt }), icono('caret-down')),
      el('div', {}, ...hijos.map(([v, href, t]) => el('a', { href, dataset: { v } }, el('span', { textContent: t })))));
  };
  byId('nav').replaceChildren(el('div', { className: 'nx-nav__group' }, ...[
    item('inicio', '#/', 'house', 'Inicio'),
    item('tickets', '#/tickets', 'ticket', 'Tickets'),
    wsAct && grupo('kanban', 'Gestión', [
      !como && publica(wsAct) && ['gestion/comunicados', '#/gestion/comunicados', 'Comunicados'],
      !como && publica(wsAct) && ['gestion/analisis', '#/gestion/analisis', 'Análisis de datos']]),
    emp.role === 'admin' && grupo('buildings', 'Administración', [
      ['admin/horario', '#/admin/horario', 'Horario'],
      wsAct && ['admin/ajustes', '#/admin/ajustes', 'Ajustes de atención'],
      wsAct && ['admin/ver-como', '#/admin/ver-como', 'Ver como'],
      ['admin/marca', '#/admin/marca', 'Marca']]),
    grupo('book-open-text', 'Documentación', DOCS.map(d => [`docs/${d.id}`, `#/docs/${d.id}`, d.titulo])),
    !como && wsAct && administra(wsAct) && grupo('gear-six', 'Configuración del workspace', SECCIONES_WS.map(([k, t]) => [`ws/${k}`, `#/ws/${k}`, t]))
  ].filter(Boolean)));
}
window.onhashchange = navegar;
function navegar() {
  const [a, b] = location.hash.replace(/^#\/?/, '').split('/');
  let v = a === 'ws' && wsAct && administra(wsAct) ? 'ws'
    : ['admin', 'nuevo-ws'].includes(a) && emp.role === 'admin' ? a
    : a === 'gestion' && wsAct && !como && publica(wsAct) ? a
    : a === 'tickets' || a === 'docs' ? a
    : a === 't' && Number(b) ? 't' : 'inicio';
  if (como && !['inicio', 'tickets', 't', 'docs'].includes(v)) v = 'inicio';   // Ver como: solo lo que ve esa persona
  if (v === 't' && tabla && tabla.vista === vista) return abrir(Number(b));   // detalle sobre la tabla ya montada
  genNav++;
  desmontarTabla();
  if (['inicio', 'tickets'].includes(v)) vista = v;
  if (v === 'gestion') subGestion = ['comunicados', 'analisis'].includes(b) ? b : 'comunicados';
  if (v === 'admin') subAdmin = ['marca', 'horario', 'ver-como', 'ajustes'].includes(b) ? b : 'horario';
  if (v === 'docs') docSel = DOCS.some(d => d.id === b) ? b : DOCS[0].id;
  if (v === 'ws') pestaña = SECCIONES_WS.some(([k]) => k === b) ? b : 'general';
  const sub = { gestion: `gestion/${subGestion}`, admin: `admin/${subAdmin}`, docs: `docs/${docSel}`, 'nuevo-ws': '', ws: `ws/${pestaña}` };
  const marcado = sub[v === 't' ? vista : v] ?? (v === 't' ? vista : v);
  document.querySelectorAll('#nav a').forEach(x => x.dataset.v === marcado ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'));
  document.querySelector('#nav a[aria-current]')?.closest('details')?.setAttribute('open', '');
  byId('msg').textContent = '';
  aplicarMarca(emp.brand);
  pintarAvisos(!(v === 'inicio' || (v === 't' && vista === 'inicio')));   // Inicio tiene su propia sección
  if (v === 'docs') return documentacion();
  if (v === 'admin') return administracion();
  if (v === 'nuevo-ws') return nuevoWorkspace();
  if (v === 'ws') return configurar(wsAct);
  if (v === 'gestion') return vistaGestion();
  pintarVista().then(() => { if (v === 't') abrir(Number(b)); });
}
const pintarVista = () => vista === 'inicio' ? inicio() : listado();
// Gestión (quien gestiona el workspace): comunicados, análisis de datos y ajustes de atención
async function vistaGestion() {
  if (subGestion === 'analisis') return vistaAnalisis();
  cabecera(ws(wsAct).name, 'Comunicados', 'Avisos de estado del servicio para quienes abren tickets en este workspace.');
  const cuerpo = el('div');
  byId('contenido').replaceChildren(cuerpo);
  await cfgComunicados(ws(wsAct), cuerpo);
}
function cabecera(eyebrow, titulo, bajada, ...acciones) {
  byId('eyebrow').textContent = eyebrow;
  byId('titulo').textContent = titulo;
  byId('bajada').textContent = bajada ?? '';
  byId('acciones').replaceChildren(...acciones.filter(Boolean));
  document.title = `${titulo} · ${cfg.producto}`;
}

// ── Inicio y listados de tickets ────────────────────────────────────────
const nuevoBtn = () => escribe() && ws(wsAct)?.is_active && el('button', { className: 'btn btn-primary', onclick: nuevoTicket }, icono('plus'), ' Nuevo ticket');
const abierto = t => !FINALES.includes(t.status);
const mio = t => t.requester_id === yo;
const loAtiendo = t => !!miRol(t.workspace_id, t.category_id);
// La RLS ya devuelve solo lo que la persona puede ver: sus solicitudes y lo de su alcance
async function cargarTickets() {
  const c = byId('contenido');
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  const error = await traerTickets();
  if (error) { c.replaceChildren(); byId('msg').textContent = error.message; return false; }
  return true;
}
const sinWorkspaces = () => el('div', { className: 'nx-empty' }, icono('ticket'), el('h3', { textContent: 'Aún no hay espacios de atención' }),
  el('p', { textContent: emp.role === 'admin' ? 'Crea el primer workspace para empezar a recibir solicitudes.' : 'Tu empresa todavía no tiene espacios de atención.' }),
  emp.role === 'admin' && escribe() && el('a', { className: 'btn btn-primary', href: '#/nuevo-ws' }, icono('plus'), ' Nuevo workspace'));

// Inicio según el rol en el workspace elegido (como el tablero por rol del TicketEasy anterior):
//   solicitante  "Mis solicitudes"     qué necesito hacer (confirmar soluciones) y en qué van las mías
//   agente       "Mi cola de trabajo"  lo que hay que tomar y lo asignado a mí
//   supervisor / owner  "Resumen del equipo"  el día y lo que está trabado en su alcance
// La sección de comunicados activos es de toda la empresa
const PERFIL_INICIO = {
  solicitante: ['Mis solicitudes', 'Revisa en qué van tus tickets o abre uno nuevo.', 'Solicitudes recientes', 'ingresados', 'Aún no abres tickets. Crea el primero con «Nuevo ticket».'],
  agente: ['Mi cola de trabajo', 'Lo que hay que tomar en tu alcance y lo que tienes asignado.', 'Tu cola reciente', 'asignados', 'No hay tickets en tu alcance por ahora.'],
  equipo: ['Resumen del equipo', 'Estado de los tickets de tu alcance.', 'Tickets recientes del equipo', 'todos_tickets', 'No hay tickets para mostrar.'],
};
const hoy = v => v && new Date(v).toDateString() === new Date().toDateString();
function perfilInicio() {
  const roles = equipo.filter(s => s.workspace_id === wsAct && s.user_id === yo).map(s => s.role);
  return roles.some(r => r === 'owner' || r === 'supervisor') ? 'equipo' : roles.length ? 'agente' : 'solicitante';
}
function filaTicket(t) {
  return el('li', {}, el('button', { type: 'button', className: 'nx-tk', onclick: () => abrir(t.id) },
    chip(t.status),
    el('span', { className: 'nx-tk__main' }, el('b', { textContent: t.subject }),
      el('small', { textContent: [`#${t.id}`, ruta(t.category_id), t.requester_id !== yo && nombre(t.requester_id), t.assignee_id && `Atiende ${nombre(t.assignee_id)}`].filter(Boolean).join(' · ') })),
    el('time', { className: 'nx-tk__when num', dateTime: t.updated_at, textContent: fecha(t.updated_at) })));
}

async function inicio() {
  const perfil = perfilInicio();
  const [titulo, bajada, tituloLista, destino, vacio] = PERFIL_INICIO[perfil];
  cabecera(ws(wsAct)?.name ?? emp.name, 'Inicio', `${titulo}: ${bajada.charAt(0).toLowerCase()}${bajada.slice(1)}`, nuevoBtn());
  if (!wsAct) { byId('contenido').replaceChildren(el('div', { className: 'nx-panel' }, sinWorkspaces())); return; }
  // Comunicados vigentes de todos los workspaces de la empresa (la RLS deja solo los que la persona puede ver)
  const [ok, { data: avisos }] = await Promise.all([cargarTickets(), sb.from('announcements').select('*').in('workspace_id', wss.map(w => w.id))]);
  if (!ok) return;
  const ahora = new Date();
  const activos = vigentesDe(avisos ?? [], ahora);
  programarAvisos(avisos ?? [], ahora, () => { if (vista === 'inicio' && !location.hash.startsWith('#/t/')) inicio(); });

  const base = perfil === 'solicitante' ? tickets.filter(mio) : tickets.filter(loAtiendo);
  const abiertos = base.filter(abierto);
  const cuenta = f => base.filter(t => enEstado(t, f)).length;
  // [etiqueta, cantidad, vista de Tickets que abre (null = no navega), ícono, destacar si hay]
  const tiles = {
    solicitante: [['Abiertas', cuenta('abiertos'), destino, 'ticket'], ['En espera de terceros', cuenta('on_hold'), destino, 'hourglass-medium'],
      ['Esperan tu respuesta', cuenta('pending_requester'), destino, 'chat-circle-dots', true],
      ['Esperan tu confirmación', cuenta('resolved'), destino, 'seal-question', true], ['Cerradas', cuenta('closed'), destino, 'lock-simple']],
    agente: [['Sin asignar', cuenta('sin_asignar'), null, 'tray', true], ['Asignados a ti', cuenta('mios'), destino, 'user-circle'],
      ['En espera de terceros', cuenta('on_hold'), destino, 'hourglass-medium'], ['Escalados', cuenta('escalated'), destino, 'arrow-fat-up']],
    equipo: [['Creados hoy', base.filter(t => hoy(t.created_at)).length, null, 'calendar-plus'], ['Resueltos hoy', base.filter(t => hoy(t.resolved_at)).length, null, 'check-circle'],
      ['Abiertos', abiertos.length, destino, 'ticket'], ['Sin asignar', cuenta('sin_asignar'), destino, 'tray', true], ['Escalados', cuenta('escalated'), destino, 'arrow-fat-up', true]],
  }[perfil];

  const lista = el('ul', { className: 'nx-tklist' });
  const buscar = perfil !== 'solicitante' && el('input', { type: 'search', className: 'form-control', placeholder: perfil === 'agente' ? 'Buscar en tu cola…' : 'Buscar tickets del equipo…', ariaLabel: 'Buscar tickets' });
  // Recientes: abiertos primero; la búsqueda mira todo el alcance
  const pintarLista = () => {
    const term = buscar ? sinTildes(buscar.value.trim().replace(/^#/, '')) : '';
    const fuente = term ? base.filter(t => [String(t.id), t.subject, nombre(t.requester_id), nombre(t.assignee_id)].some(s => sinTildes(s).includes(term)))
      : [...abiertos, ...base.filter(t => !abierto(t))];
    const vis = (perfil === 'agente' && !term ? fuente.filter(t => !t.assignee_id || t.assignee_id === yo) : fuente).slice(0, 8);
    lista.replaceChildren(...(vis.length ? vis.map(filaTicket) : [el('li', { className: 'nx-quiet', textContent: term ? 'Nada coincide con la búsqueda.' : vacio })]));
  };
  if (buscar) buscar.oninput = pintarLista;
  pintarLista();

  byId('contenido').replaceChildren(
    el('section', { className: 'nx-panel nx-inicio-avisos' },
      el('div', { className: 'nx-panel__head' }, el('h2', { textContent: 'Comunicados activos' }),
        el('span', { className: 'nx-panel__aside', textContent: 'De todos los workspaces de la empresa' })),
      el('div', { className: 'nx-panel__body' }, activos.length ? el('div', { className: 'nx-avisos' }, ...activos.map(tarjetaAviso))
        : el('p', { className: 'nx-quiet', textContent: 'No hay comunicados activos.' }))),
    buscar && el('label', { className: 'nx-search nx-inicio-buscar' }, icono('magnifying-glass'), buscar),
    el('div', { className: 'nx-tiles' }, ...tiles.map(([l, n, f, ic, destacar]) => {
      const cls = `nx-tile ${destacar ? 'nx-tile--accion' : ''} ${destacar && n ? 'has-items' : ''}`;
      const cuerpo = [el('span', { className: 'nx-item__icon' }, icono(ic)), el('b', { className: 'num', textContent: n }), el('span', { textContent: l })];
      return f ? el('a', { className: cls, href: '#/tickets', onclick: () => { filtro = f; } }, ...cuerpo) : el('div', { className: cls }, ...cuerpo);
    })),
    el('section', { className: 'nx-panel' },
      el('div', { className: 'nx-panel__head' }, el('h2', { textContent: tituloLista }),
        el('a', { className: 'nx-panel__aside', href: '#/tickets', onclick: () => { filtro = destino; } }, 'Ver todos ', icono('arrow-right'))),
      el('div', { className: 'nx-panel__body' }, lista)));
}

// ── Tickets y Tickets del equipo: DataViews (ClientApp → wwwroot/dataviews) ──
// El componente React se monta en #tabla y se desmonta al salir de la vista. Vistas guardadas por persona,
// workspace y alcance (localStorage). Arrastrar cambia solo el estado: quien atiende el ticket y por el ciclo de vida
const ESTADO_DE = Object.fromEntries(Object.keys(PASOS).map(k => [TEXTO[k], k]));
// Estados que piden comentario al soltar: [etiqueta, ayuda, tipo de mensaje]
const COMENTA = {
  resolved: ['Qué se hizo para resolverlo', 'Lo ve el solicitante, que confirma si quedó resuelto.', 'reply'],
  on_hold: ['A quién se espera y por qué', 'Por ejemplo un proveedor u otra área. Lo ve el solicitante.', 'reply'],
  pending_requester: ['Qué información necesitas', 'Lo ve el solicitante. El ticket espera su respuesta y vuelve a En curso cuando conteste.', 'reply'],
  escalated: ['Por qué se escala', 'Nota interna: solo la ve el equipo.', 'internal_note'],
};
let tabla = null;   // { vista, desmontar } mientras está montada
let pendiente = null;   // carga ya pedida (refrescar) que la próxima load de DataViews reutiliza
let genNav = 0;   // cambia en cada navegación: una carga lenta no monta sobre otra vista
const tablaLista = () => window.TicketTabla ? Promise.resolve() : new Promise(r => addEventListener('tickettabla:lista', r, { once: true }));
function desmontarTabla() {
  tabla?.desmontar();
  tabla = null;
}
async function traerTickets() {
  // ponytail: tope de 1000 tickets con búsqueda en el navegador; paginar con .range() cuando crezca
  const { data, error } = como ? await sb.rpc('tickets_como', { p_ws: wsAct, p_user: como.id })
    : await sb.from('tickets').select('*').eq('workspace_id', wsAct).order('updated_at', { ascending: false }).limit(1000);
  if (!error) tickets = data;
  return error;
}
// Vuelve a pintar la vista actual con los datos al día; con la tabla montada, sin desmontarla
async function refrescar() {
  if (!tabla) return pintarVista();
  pendiente = traerTickets();
  await pendiente;
  dispatchEvent(new Event('dataviews:reload'));
}
const filaTabla = t => ({
  id: t.id, asunto: t.subject, estado: texto(t.status), prioridad: texto(t.priority), tipo: texto(t.type), categoria: ruta(t.category_id),
  solicitante: nombre(t.requester_id), asignado: t.assignee_id ? nombre(t.assignee_id) : '', creado: t.created_at, movimiento: t.updated_at, _t: t });

// Mismo criterio que la RLS de tickets y private.te_transicion_valida: el cliente solo evita el intento
function validarMovimiento(fila, valor) {
  const t = fila._t, a = ESTADO_DE[valor];
  if (!escribe()) return como ? 'Estás viendo como otra persona: solo lectura.' : 'El plan de TicketEasy de tu empresa venció: solo lectura.';
  if (!miRol(t.workspace_id, t.category_id)) return 'Solo el equipo que atiende este ticket puede cambiarle el estado.';
  if (!PASOS[t.status].includes(a)) return PASOS[t.status].length
    ? `Un ticket ${texto(t.status).toLowerCase()} solo puede pasar a ${PASOS[t.status].map(x => texto(x).toLowerCase()).join(' o ')}.`
    : 'Un ticket cerrado no cambia de estado.';
  return null;
}
// Al soltar: confirma, o pide el comentario si el estado lo necesita. Resuelve al guardar; rechaza con null si se cancela
// Cancelar: motivo y, según el motivo, el ticket original o el comunicado (mismas reglas que te_ticket_al_cancelar)
const MOTIVOS = ['duplicate', 'not_applicable', 'announcement', 'withdrawn', 'other'];
function camposCancelar(t) {
  const motivo = sel(MOTIVOS.map(m => [m, texto(m)]), 'duplicate');
  const original = el('input', { type: 'number', className: 'form-control', min: 1, placeholder: 'Por ejemplo 24' });
  const aviso = el('select', { className: 'form-select' }, opcion('', 'Cargando comunicados…'));
  const comentario = el('textarea', { className: 'form-control', rows: 3, maxLength: 5000 });
  const cOriginal = campo('Duplicado del ticket N.º', original, { hint: 'El ticket que sigue abierto, de este mismo workspace.' });
  const cAviso = campo('Comunicado', aviso, { full: true });
  const cComentario = campo('Comentario para el solicitante', comentario, { full: true });
  sb.from('announcements').select('id, title, message, starts_at').eq('workspace_id', t.workspace_id).order('starts_at', { ascending: false }).limit(50)
    .then(({ data }) => aviso.replaceChildren(...(data?.length ? data.map(a => opcion(String(a.id), a.title ?? a.message.slice(0, 80)))
      : [opcion('', 'Este workspace no tiene comunicados')])));
  const ver = () => {
    const m = motivo.value;
    cOriginal.hidden = m !== 'duplicate';
    cAviso.hidden = m !== 'announcement';
    original.required = m === 'duplicate';
    aviso.required = m === 'announcement';
    // Duplicado y comunicado ya explican el motivo; el resto necesita contarle al solicitante por qué
    comentario.required = !['duplicate', 'announcement'].includes(m);
    cComentario.querySelector('span').textContent = comentario.required ? 'Comentario para el solicitante' : 'Comentario para el solicitante (opcional)';
  };
  motivo.onchange = ver;
  ver();
  return {
    nodos: [campo('Motivo', motivo, { full: true }), cOriginal, cAviso, cComentario],
    foco: motivo,
    cambios: () => ({ status: 'cancelled', cancel_reason: motivo.value,
      duplicate_of: motivo.value === 'duplicate' ? Number(original.value) : null,
      announcement_id: motivo.value === 'announcement' ? Number(aviso.value) : null }),
    // Lo que se le escribe al solicitante: su comentario o, si no hay, el motivo con su referencia
    mensaje: () => comentario.value.trim() ? aHtml(comentario.value.trim())
      : motivo.value === 'duplicate' ? aHtml(`Lo cerramos como duplicado del ticket #${original.value}, donde seguimos atendiendo.`)
      : aHtml(`Es parte de lo informado en el comunicado «${aviso.selectedOptions[0]?.textContent ?? ''}».`),
  };
}

// Cambia el estado con confirmación, o con el formulario si el estado lo pide (comentario o motivo de cancelación).
// Resuelve al guardar; rechaza con null si se cancela y con el error si la base lo rechaza
function moverEstado(t, a) {
  const valor = texto(a);
  return new Promise((resolve, reject) => {
    let listo = false;
    const err = errP();
    const pide = COMENTA[a];
    const cancelar = a === 'cancelled' && camposCancelar(t);
    const comentario = pide && el('textarea', { className: 'form-control', rows: 4, required: true, maxLength: 5000 });
    const btn = el('button', { className: `btn ${a === 'cancelled' ? 'btn-outline-danger' : 'btn-primary'}` }, icono(ACCION[a]?.[1] ?? 'check'), ` ${ACCION[a]?.[0] ?? `Mover a ${valor}`}`);
    dialogo(`Ticket #${t.id}`, `${texto(t.status)} → ${valor}`, false,
      el('div', { className: 'nx-fields' },
        el('p', { className: 'nx-field--full', style: 'margin:0', textContent: t.subject }),
        ...(cancelar ? cancelar.nodos
          : [pide ? campo(pide[0], comentario, { full: true, hint: pide[1] }) : el('p', { className: 'nx-field--full nx-faint', style: 'margin:0', textContent: `¿Mover el ticket a ${valor.toLowerCase()}?` })])),
      pie(err, btn));
    (cancelar?.foco ?? comentario ?? btn).focus();
    dlg.addEventListener('close', () => { if (!listo) reject(null); }, { once: true });
    frm.onsubmit = async e => {
      e.preventDefault();
      err.textContent = '';
      if (!frm.reportValidity()) return;
      const cambios = cancelar ? cancelar.cambios() : { status: a };
      if (cancelar && cambios.duplicate_of === t.id) { err.textContent = 'Un ticket no puede ser duplicado de sí mismo.'; return; }
      const r = await ocupado(btn, async () => {
        const { error } = await sb.from('tickets').update(cambios).eq('id', t.id);
        if (error) return error;
        const msg = cancelar ? { kind: 'reply', body: cancelar.mensaje() } : pide && { kind: pide[2], body: aHtml(comentario.value.trim()) };
        return msg ? (await sb.from('ticket_messages').insert({ ticket_id: t.id, ...msg })).error : null;
      });
      if (r && !listo && r.code === '23514') { err.textContent = r.message; return; }   // motivo inválido: se corrige en el mismo formulario
      listo = true;
      dlg.close();
      if (r) { reject(new Error(r.message)); return; }
      toast(`Ticket #${t.id}: ${valor.toLowerCase()}.`);
      resolve();
      setTimeout(refrescar);   // asignado, fechas y conversación quedan al día
    };
  });
}
const moverTicket = (fila, valor) => moverEstado(fila._t, ESTADO_DE[valor]);

async function listado() {
  const g = genNav;
  cabecera(ws(wsAct)?.name ?? emp.name, 'Tickets', 'Los que ingresaste y, si eres del equipo, los que atiendes.', nuevoBtn());
  const c = byId('contenido');
  if (!wsAct) { c.replaceChildren(el('div', { className: 'nx-panel' }, sinWorkspaces())); return; }
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  await tablaLista();
  if (g !== genNav) return;
  const caja = el('div', { id: 'tabla' });
  c.replaceChildren(caja);
  // Tickets: alcances según el rol en el workspace. Todos ingresan; el equipo además atiende; supervisor, owner y admin ven todo
  const roles = equipo.filter(s => s.workspace_id === wsAct && s.user_id === yo).map(s => s.role);
  const fuentes = ['mine', ...(roles.length ? ['assigned'] : []),
    ...(roles.some(r => r === 'owner' || r === 'supervisor') || emp.role === 'admin' ? ['all'] : [])];
  const DE_FUENTE = { mine: mio, assigned: t => t.assignee_id === yo, all: () => true };
  const desmontar = window.TicketTabla.montar(caja, {
    storageKey: `ticketeasy-dataviews:v5:${yo}:${wsAct}:tickets:${fuentes.join(',')}`,
    fuentes,
    categorias: arbol(wsAct, false).map(([k]) => ruta(k.id)),
    equipo: [...new Set(equipo.filter(s => s.workspace_id === wsAct).map(s => nombre(s.user_id)))].sort((x, y) => x.localeCompare(y, 'es')),
    vistaInicial: filtro ?? undefined,
    load: async fuente => {
      const p = pendiente ?? traerTickets();
      pendiente = null;
      const error = await p;
      if (error) throw new Error(error.message);
      return tickets.filter(DE_FUENTE[fuente] ?? mio).map(filaTabla);
    },
    validateMove: validarMovimiento,
    onMove: moverTicket,
  });
  filtro = null;   // el contador de Inicio elige la vista una vez; después manda la última que usó la persona
  tabla = { vista: 'tickets', desmontar };
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
dlg.addEventListener('close', () => { if (location.hash.startsWith('#/t/')) history.replaceState(null, '', vista === 'inicio' ? '#/' : `#/${vista}`); });

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
// Siempre en el workspace elegido en la barra lateral
function nuevoTicket() {
  const w = ws(wsAct);
  const err = errP();
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
  selCat.replaceChildren(...opcionesCat(w.id, 'Sin categoría').map(([id, t]) => opcion(id, t)));
  campoPara.hidden = !esEquipo(w.id);
  selPara.replaceChildren(...[...gente].map(([id, n]) => opcion(id, id === yo ? `${n} (yo)` : n, id === yo)));
  selCat.onchange = alCambiarCat;
  const crear = el('button', { className: 'btn btn-primary', textContent: 'Crear ticket' });
  dialogo(w.name, 'Nuevo ticket', false,
    el('div', { className: 'nx-fields' },
      campo('Categoría', selCat), campo('Tipo', selTipo), campo('Prioridad', selPrio), campoPara,
      campo('Asunto', asunto, { full: true }),
      el('div', { className: 'nx-field nx-field--full' }, el('span', {}, 'Descripción', el('em', { textContent: ' *', ariaHidden: 'true' })), desc.nodo),
      extra),
    pie(err, crear));
  alCambiarCat();
  asunto.focus();
  frm.onsubmit = async e => {
    e.preventDefault();
    err.textContent = '';
    if (!frm.reportValidity()) return;
    const falta = desc.vacio() ? 'Describe qué necesitas.' : dinamicos.map(d => d.error()).find(Boolean);
    if (falta) { err.textContent = falta; return; }
    const fila = {
      workspace_id: w.id, category_id: selCat.value || null, type: selTipo.value, priority: selPrio.value,
      subject: asunto.value.trim(), description: desc.html(),
      custom_fields: dinamicos.map(d => ({ key: d.f.key, label: d.f.label, type: d.f.field_type, value: d.valor() })).filter(x => x.value !== null) };
    if (!campoPara.hidden && selPara.value !== yo) fila.requester_id = selPara.value;
    const { data, error } = await ocupado(crear, () => sb.from('tickets').insert(fila).select('id').single());
    if (error) { err.textContent = error.code === '42501' ? 'No tienes acceso para abrir tickets en este workspace.' : error.message; return; }
    dlg.close();
    toast(`Ticket #${data.id} creado.`);
    await refrescar();
  };
}

// ── Detalle del ticket ──────────────────────────────────────────────────
async function abrir(id) {
  let t = tickets.find(x => x.id === id);
  if (!t && !como) ({ data: t } = await sb.from('tickets').select('*').eq('id', id).eq('company_id', emp.company_id).maybeSingle());
  if (!t) { if (dlg.open) dlg.close(); toast(`No encontramos el ticket #${id}.`, 'warning-circle'); return; }
  history.replaceState(null, '', `#/t/${t.id}`);
  marcar(notifs.filter(n => n.ticket_id === t.id && !n.read_at).map(n => n.id));
  const rol = miRol(t.workspace_id, t.category_id);
  const err = errP();
  const w = ws(t.workspace_id);
  const fb = t.status === 'closed' ? (await sb.from('ticket_feedback').select('*').eq('ticket_id', t.id).maybeSingle()).data : null;
  const vence = t.awaiting_since && w?.autoclose_enabled && new Date(new Date(t.awaiting_since).getTime() + w.autoclose_hours * 36e5);
  const datos = el('div', { className: 'nx-fields' },
    t.status === 'pending_requester' && el('div', { className: 'nx-confirma nx-field--full' },
      el('p', {}, el('b', { textContent: t.requester_id === yo ? 'El equipo necesita información para seguir. ' : 'Esperando al solicitante. ' }),
        t.requester_id === yo ? 'Responde en la conversación y el ticket vuelve a atenderse.' : `Desde ${fecha(t.awaiting_since)}.`,
        vence ? ` Si no hay respuesta, se cancela el ${fecha(vence)}.` : '')),
    el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Descripción' }), rico(t.description)),
    verCampos(t.custom_fields),
    campoRo('Solicitante', nombre(t.requester_id)),
    campoRo('Creado', fecha(t.created_at)),
    t.status === 'cancelled' && el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Cancelado' }),
      el('p', { className: 'nx-ro' }, `${texto(t.cancel_reason)} · ${fecha(t.cancelled_at)}`,
        t.duplicate_of && el('span', {}, ' · original ', el('a', { href: `#/t/${t.duplicate_of}`, textContent: `#${t.duplicate_of}` })))));
  if (fb) datos.append(verEncuesta(fb));
  else if (t.status === 'closed' && t.requester_id === yo && w?.survey_enabled && escribe())
    datos.append(el('div', { className: 'nx-confirma nx-field--full' }, el('p', {}, el('b', { textContent: '¿Cómo fue la atención? ' }), 'Tu calificación ayuda al equipo a mejorar.'),
      el('div', {}, el('button', { type: 'button', className: 'btn btn-sm btn-primary', onclick: () => encuesta(t) }, icono('star'), ' Calificar'))));
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
  await refrescar();
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
        onclick: () => s === 'cancelled' || COMENTA[s] ? moverEstado(t, s).then(() => abrir(t.id), e => e ? (abrir(t.id), toast(e.message, 'warning-circle')) : abrir(t.id))
          : cambiar(t, { status: s }, err, `Ticket #${t.id}: ${texto(s).toLowerCase()}.`) }, icono(ACCION[s][1]), ` ${ACCION[s][0]}`)))
        : el('p', { className: 'nx-ro nx-faint', textContent: t.status === 'cancelled' ? 'Ticket cancelado.' : 'Ticket cerrado.' })),
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
    await refrescar();
    if (aceptado && ws(t.workspace_id)?.survey_enabled) encuesta(t); else abrir(t.id);
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
    let { data, error } = await sb.from('ticket_messages').select('*').eq('ticket_id', t.id).order('created_at', { ascending: false });
    if (error) { lista.replaceChildren(el('li', { className: 'nx-error', textContent: error.message })); return; }
    cuenta.replaceChildren(el('b', { textContent: String(data.length) }), data.length === 1 ? ' registro' : ' registros');
    if (!rol) data = data.filter(m => m.kind !== 'internal_note');
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
  const seccion = SECCIONES_WS.find(([k]) => k === pestaña)[1];
  cabecera(`Configuración · ${w.name}`, seccion, w.is_active ? null : 'Inactivo: no recibe tickets nuevos.');
  const cuerpo = el('div');
  byId('contenido').replaceChildren(cuerpo);
  ({ general: cfgGeneral, categorias: cfgCategorias, equipo: cfgEquipo, feriados: cfgFeriados, acceso: cfgAcceso })[pestaña](w, cuerpo);
}

function cfgGeneral(w, c) {
  const nombreIn = el('input', { className: 'form-control', value: w.name, required: true, minLength: 2, maxLength: 80 });
  const modo = sel([['open', 'Abierto: todos los miembros, menos la lista negra'], ['restricted', 'Restringido: solo la lista blanca']], w.access_mode);
  const logo = el('input', { type: 'url', className: 'form-control', value: w.logo_url ?? '', placeholder: 'https://…/logo.svg', pattern: String.raw`https://\S+`, maxLength: 1500 });
  const activo = el('input', { type: 'checkbox', className: 'form-check-input', checked: w.is_active });
  const err = errP(), btn = boton('Guardar', 'floppy-disk');
  btn.onclick = () => nombreIn.reportValidity() && logo.reportValidity() && guardar(btn, err,
    () => sb.from('workspaces').update({ name: nombreIn.value.trim(), access_mode: modo.value, is_active: activo.checked, logo_url: logo.value.trim() || null }).eq('id', w.id), 'Workspace actualizado.');
  c.replaceChildren(panel('General', null,
    el('div', { className: 'nx-row' }, campo('Nombre', nombreIn), campo('Quién puede abrir tickets', modo)),
    el('div', { className: 'nx-row' }, campo('Logo (URL https, opcional)', logo, { hint: 'Sin logo se muestra la inicial del nombre.' })),
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

// ── Notificaciones (de toda la empresa, no solo del workspace elegido) ──
// Las crean triggers en la base (te_notif_ticket, te_notif_mensaje) y llegan en vivo por Realtime
const ICONO_NOTIF = { new_ticket: 'ticket', assigned: 'user-circle-plus', status: 'arrows-left-right', message: 'chat-circle', reminder: 'alarm' };
let notifs = [], canal = null;
function textoNotif(n) {
  const quien = n.actor_id ? nombre(n.actor_id) : 'TicketEasy';   // sin actor: el cierre automático
  const d = n.data;
  return n.kind === 'reminder' ? `Esperamos tu respuesta: si no contestas, se cancela el ${fecha(d.closes_at)}`
    : n.kind === 'new_ticket' ? `${quien} abrió un ticket`
    : n.kind === 'assigned' ? (d.auto ? 'Se te asignó automáticamente un ticket' : `${quien} te asignó un ticket`)
    : n.kind === 'status' ? `${quien} lo pasó de ${texto(d.from).toLowerCase()} a ${texto(d.to).toLowerCase()}`
    : d.message_kind === 'internal_note' ? `${quien} dejó una nota interna` : `${quien} respondió`;
}
async function cargarNotifs() {
  // ponytail: las 50 más recientes; paginar si hace falta ver más atrás
  const { data } = await sb.from('notifications').select('*').eq('company_id', emp.company_id).order('created_at', { ascending: false }).limit(50);
  notifs = data ?? [];
  pintarNotifs();
}
function pintarNotifs() {
  const sinLeer = notifs.filter(n => !n.read_at);
  const badge = byId('campanaN');
  badge.hidden = !sinLeer.length;
  badge.textContent = sinLeer.length > 9 ? '9+' : sinLeer.length;
  byId('campana').ariaLabel = sinLeer.length ? `Notificaciones: ${sinLeer.length} sin leer` : 'Notificaciones';
  const todas = sinLeer.length && el('button', { type: 'button', className: 'nx-act', onclick: () => marcar(sinLeer.map(n => n.id)) }, icono('checks'), ' Marcar todo como leído');
  byId('notifs').replaceChildren(
    el('div', { className: 'nx-notifs__head' }, el('b', { textContent: 'Notificaciones' }), todas),
    notifs.length ? el('ul', { className: 'nx-notifs__list' }, ...notifs.map(n => el('li', {}, el('button', {
      type: 'button', className: `nx-notif ${n.read_at ? '' : 'is-new'}`, onclick: () => abrirNotif(n) },
      el('span', { className: 'nx-item__icon' }, icono(ICONO_NOTIF[n.kind])),
      el('span', {}, el('b', { textContent: textoNotif(n) }),
        el('small', { textContent: [`#${n.ticket_id} ${n.data.subject ?? ''}`, ws(n.workspace_id)?.name, fecha(n.created_at)].filter(Boolean).join(' · ') }))))))
      : el('p', { className: 'nx-quiet', textContent: 'Sin notificaciones.' }));
}
async function marcar(ids) {
  if (!ids.length) return;
  const ahora = new Date().toISOString();
  notifs.forEach(n => { if (ids.includes(n.id)) n.read_at ??= ahora; });
  pintarNotifs();
  await sb.from('notifications').update({ read_at: ahora }).in('id', ids).is('read_at', null);
}
// Abre el ticket en su workspace (la campana es de toda la empresa)
function abrirNotif(n) {
  byId('notifs').hidePopover();
  if (como) { salirComo(true); pintarNav(); }   // las notificaciones son de la propia cuenta
  if (n.workspace_id !== wsAct && ws(n.workspace_id)) elegirWs(n.workspace_id);
  const destino = `#/t/${n.ticket_id}`;
  if (location.hash === destino) navegar(); else location.hash = destino;
}
function escucharNotifs() {
  if (canal) return;
  canal = sb.channel(`notifs:${yo}`).on('postgres_changes', { event: 'INSERT', schema: 'ticketeasy', table: 'notifications', filter: `user_id=eq.${yo}` }, ({ new: n }) => {
    if (n.company_id !== emp?.company_id) return;
    notifs.unshift(n);
    pintarNotifs();
    toast(textoNotif(n), ICONO_NOTIF[n.kind]);
  }).subscribe();
}
byId('notifs').addEventListener('toggle', e => { if (e.newState === 'open') ubicar(byId('notifs'), byId('campana')); });

// ── Ver como (Administración) ───────────────────────────────────────────
// El admin de la empresa ve Inicio y Tickets del workspace elegido como otra persona, en solo lectura. Los tickets los da
// ticketeasy.tickets_como (revalida el permiso en la base); el resto de la UI se calcula con `yo` = esa persona
let como = null;   // { id, yoReal, empReal } mientras dura
function verComo(id) {
  como = { id, yoReal: yo, empReal: emp };
  yo = id;
  emp = { ...emp, role: 'usuario', access: 'lectura' };   // sin escritura ni administración mientras dura
  const volver = el('button', { type: 'button', className: 'btn btn-sm btn-outline-secondary', onclick: () => salirComo() }, icono('arrow-u-up-left'), ' Volver a mi vista');
  byId('comoBanner').replaceChildren(el('span', {}, icono('eye'), `Estás viendo TicketEasy como ${nombre(id)}. Solo lectura.`), volver);
  byId('comoBanner').hidden = false;
  pintarNav();
  if (location.hash === '#/') navegar(); else location.hash = '#/';
}
function salirComo(sinNavegar) {
  if (!como) return;
  yo = como.yoReal;
  emp = como.empReal;
  como = null;
  byId('comoBanner').hidden = true;
  if (sinNavegar) return;
  pintarNav();
  location.hash = '#/admin/ver-como';
}
function vistaVerComo() {
  cabecera(ws(wsAct).name, 'Ver como', 'Mira Inicio y Tickets tal como los ve otra persona de este workspace. Es solo lectura: no puedes responder ni cambiar nada en su nombre.');
  const rolEn = id => ROLES.find(r => equipo.some(s => s.workspace_id === wsAct && s.user_id === id && s.role === r));
  const personas = [...gente].filter(([id]) => id !== yo).sort((a, b) => a[1].localeCompare(b[1], 'es'));
  // Agrupadas por su mejor rol en el workspace; quien no es del equipo, como solicitante
  const grupos = [...ROLES, null].map(r => [r, personas.filter(([id]) => (rolEn(id) ?? null) === r)]).filter(([, ps]) => ps.length);
  const persona = el('select', { className: 'form-select' }, opcion('', 'Elige una persona…', true),
    ...grupos.map(([r, ps]) => el('optgroup', { label: r ? texto(r) : 'Solicitantes' }, ...ps.map(([id, n]) => opcion(id, n)))));
  const err = errP(), btn = boton('Ver como', 'eye');
  btn.onclick = () => persona.value ? verComo(persona.value) : (err.textContent = 'Elige una persona.');
  byId('contenido').replaceChildren(panel('Persona', 'Agrupadas por su rol en este workspace. Quien no es del equipo aparece como solicitante.',
    el('div', { className: 'nx-row' }, campo('Ver la app como', persona), btn), err));
}

// ── Documentación ───────────────────────────────────────────────────────
// Diagramas de archify: la definición vive en diagramas/*.json y el HTML generado en wwwroot/diagramas/.
// Para sumar uno: generarlo ahí con archify y agregarlo a esta lista
const DOCS = [
  { id: 'ciclo-de-vida', titulo: 'Ciclo de vida de un ticket', bajada: 'Estados, transiciones permitidas y quién mueve cada ticket.', src: '/diagramas/tickets.html', icono: 'flow-arrow' },
  { id: 'asignacion', titulo: 'Cómo se asignan los tickets', bajada: 'Asignación automática opcional por workspace: categoría, activo, turno, guardias, feriados y carga.', src: '/diagramas/asignacion.html', icono: 'user-switch' },
];
let docSel = DOCS[0].id;
function documentacion() {
  const d = DOCS.find(x => x.id === docSel) ?? DOCS[0];
  cabecera('Documentación', d.titulo, d.bajada,
    el('a', { className: 'btn btn-outline-secondary', href: d.src, target: '_blank', rel: 'noopener' }, icono('arrow-square-out'), ' Abrir en pestaña nueva'));
  byId('contenido').replaceChildren(el('iframe', { className: 'nx-doc', src: d.src, title: d.titulo, loading: 'lazy' }));
}

// ── Encuesta de satisfacción (como Uber: estrellas y etiquetas) ─────────
// Mismas etiquetas que el check de ticketeasy.ticket_feedback: elogios con 4–5 estrellas, problemas con 1–3
const ESTRELLAS = ['Muy mala', 'Mala', 'Regular', 'Buena', 'Excelente'];
const ETIQUETAS = {
  bien: [['fast', 'Rápida respuesta'], ['solved', 'Resolvió el problema'], ['communication', 'Buena comunicación'], ['kind', 'Amable y cordial'], ['clear', 'Explicó con claridad']],
  mal: [['slow', 'Tardó en responder'], ['unsolved', 'No resolvió del todo'], ['poor_communication', 'Poca comunicación'], ['had_to_insist', 'Tuve que insistir'], ['unclear', 'Difícil de entender']],
};
const textoEtiqueta = Object.fromEntries([...ETIQUETAS.bien, ...ETIQUETAS.mal]);
const estrellas = n => el('span', { className: 'nx-stars', role: 'img', ariaLabel: `${n} de 5 estrellas` },
  ...[1, 2, 3, 4, 5].map(i => el('i', { className: `ph${i <= n ? '-fill' : ''} ph-star`, ariaHidden: 'true' })));
// Lo que muestra el detalle de un ticket calificado
const verEncuesta = fb => el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Calificación del solicitante' }),
  el('div', { className: 'nx-encuesta__ver' }, estrellas(fb.rating), el('b', { textContent: ESTRELLAS[fb.rating - 1] }),
    ...fb.tags.map(k => el('span', { className: `nx-chip k-${fb.rating >= 4 ? 'ok' : 'warn'}`, textContent: textoEtiqueta[k] ?? k }))),
  fb.comment && el('p', { className: 'nx-ro', textContent: `«${fb.comment}»` }));

function encuesta(t) {
  let nota = 0;
  const elegidas = new Set();
  const err = errP();
  const leyenda = el('p', { className: 'nx-encuesta__nota', textContent: 'Toca una estrella' });
  const fila = el('div', { className: 'nx-encuesta__estrellas', role: 'radiogroup', ariaLabel: 'Calificación' });
  const etiquetas = el('div', { className: 'nx-filters nx-encuesta__tags' });
  const titulo = el('p', { className: 'nx-encuesta__pregunta' });
  const comentario = el('textarea', { className: 'form-control', rows: 2, maxLength: 1000, placeholder: 'Cuéntanos más (opcional)', ariaLabel: 'Comentario' });
  const enviar = el('button', { className: 'btn btn-primary', disabled: true }, icono('paper-plane-right'), ' Enviar calificación');
  const pintar = () => {
    fila.replaceChildren(...[1, 2, 3, 4, 5].map(i => el('button', {
      type: 'button', role: 'radio', ariaChecked: String(i === nota), ariaLabel: `${i} estrella${i > 1 ? 's' : ''}: ${ESTRELLAS[i - 1]}`, className: 'nx-encuesta__star',
      onclick: () => { if (i >= 4 !== nota >= 4) elegidas.clear(); nota = i; pintar(); } }, el('i', { className: `ph${i <= nota ? '-fill' : ''} ph-star`, ariaHidden: 'true' }))));
    leyenda.textContent = nota ? ESTRELLAS[nota - 1] : 'Toca una estrella';
    titulo.textContent = !nota ? '' : nota >= 4 ? '¿Qué destacas?' : '¿Qué podemos mejorar?';
    etiquetas.replaceChildren(...(nota ? ETIQUETAS[nota >= 4 ? 'bien' : 'mal'] : []).map(([k, l]) => el('button', {
      type: 'button', className: 'nx-filter', ariaPressed: String(elegidas.has(k)), onclick: () => { elegidas.has(k) ? elegidas.delete(k) : elegidas.add(k); pintar(); } }, l)));
    enviar.disabled = !nota;
  };
  dialogo(`Ticket #${t.id}`, '¿Cómo fue la atención?', false,
    el('div', { className: 'nx-encuesta' }, el('p', { className: 'nx-faint', textContent: t.subject }), fila, leyenda, titulo, etiquetas, comentario),
    el('div', { className: 'nx-dialog__foot' }, err,
      el('button', { type: 'button', className: 'btn btn-outline-secondary', textContent: 'Ahora no', onclick: () => { dlg.close(); abrir(t.id); } }), enviar));
  pintar();
  frm.onsubmit = async e => {
    e.preventDefault();
    err.textContent = '';
    const { error } = await ocupado(enviar, () => sb.from('ticket_feedback').insert({ ticket_id: t.id, requester_id: yo, rating: nota, tags: [...elegidas], comment: comentario.value.trim() || null }));
    if (error) { err.textContent = error.code === '23505' ? 'Ya calificaste este ticket.' : error.message; return; }
    toast('¡Gracias por tu calificación!', 'star');
    abrir(t.id);
  };
}

// ── Ajustes de atención (Administración): cierre automático, asignación automática, feriados y encuesta, por workspace ──
function vistaAjustes() {
  const w = ws(wsAct);
  cabecera(w.name, 'Ajustes de atención', 'Cómo se comportan los tickets de este workspace.');
  const autoclose = el('input', { type: 'checkbox', className: 'form-check-input', checked: w.autoclose_enabled });
  const horas = el('input', { type: 'number', className: 'form-control', min: 1, max: 720, step: 1, required: true, value: w.autoclose_hours, style: 'max-width:140px' });
  const sugeridas = el('div', { className: 'nx-filters' }, ...[24, 48, 72, 168].map(h => el('button', { type: 'button', className: 'nx-filter', textContent: h === 168 ? '1 semana' : `${h} h`, onclick: () => { horas.value = h; ver(); } })));
  const resumen = el('p', { className: 'nx-faint', style: 'margin:0' });
  const encuestaOn = el('input', { type: 'checkbox', className: 'form-check-input', checked: w.survey_enabled });
  const autoAsignar = el('input', { type: 'checkbox', className: 'form-check-input', checked: w.auto_assign_enabled });
  const feriadosOn = el('input', { type: 'checkbox', className: 'form-check-input', checked: w.holidays_enabled });
  const ver = () => {
    horas.disabled = !autoclose.checked;
    const h = Number(horas.value) || 0;
    resumen.textContent = autoclose.checked
      ? `Un ticket en Pendiente de respuesta se cancela si el solicitante no contesta en ${h} h. A las ${Math.round(h / 2)} h le llega un recordatorio.`
      : 'Los tickets en Pendiente de respuesta esperan sin plazo hasta que el solicitante conteste.';
  };
  autoclose.onchange = ver;
  horas.oninput = ver;
  ver();
  const err = errP(), btn = boton('Guardar', 'floppy-disk');
  btn.onclick = () => (!autoclose.checked || horas.reportValidity()) && guardar(btn, err, () => sb.rpc('update_service_settings', {
    p_ws: w.id, p_autoclose_enabled: autoclose.checked, p_autoclose_hours: Number(horas.value) || w.autoclose_hours, p_survey_enabled: encuestaOn.checked,
    p_auto_assign_enabled: autoAsignar.checked, p_holidays_enabled: feriadosOn.checked }), 'Ajustes guardados.');
  byId('contenido').replaceChildren(el('div', { style: 'display:grid;gap:24px' },
    panel('Cierre automático', 'Para tickets en Pendiente de respuesta: el equipo pidió información y espera al solicitante. Si contesta, vuelve solo a En curso.',
      el('label', { className: 'nx-check' }, autoclose, 'Cancelar automáticamente si el solicitante no responde'),
      el('div', { className: 'nx-row' }, campo('Plazo en horas', horas), sugeridas), resumen),
    panel('Asignación automática', 'Al crear un ticket, se asigna a quien atiende su categoría y está activo: si alguien está en turno, el de menos tickets abiertos; si no, el que entra antes en turno. Ver Documentación → Cómo se asignan los tickets.',
      el('label', { className: 'nx-check' }, autoAsignar, 'Asignar automáticamente los tickets nuevos'),
      el('label', { className: 'nx-check' }, feriadosOn, 'Considerar feriados: ese día nadie está en turno salvo quien tenga guardia')),
    panel('Encuesta de satisfacción', 'Al cerrar un ticket, el solicitante califica la atención de 1 a 5 estrellas y elige qué destacar o qué mejorar.',
      el('label', { className: 'nx-check' }, encuestaOn, 'Pedir calificación al cerrar un ticket')),
    el('div', { className: 'nx-row' }, btn), err));
}

// ── Horarios, guardias y feriados ───────────────────────────────────────
// Semana ISO como en la base (1 = lunes … 7 = domingo). La regla de "en turno" vive en private.te_rangos_del_dia
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const hhmm = t => (t ?? '').slice(0, 5);
const fechaDia = d => new Date(`${d}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
// Editor de una semana: rangos por día (vacío = no atiende ese día). valor() devuelve [{ weekday, starts, ends }]
function editorSemana(rangos) {
  const dias = DIAS.map((nombreDia, i) => {
    const dia = i + 1;
    const lista = el('div', { className: 'nx-semana__rangos' });
    const nada = el('span', { className: 'nx-faint', textContent: 'No atiende' });
    lista.append(nada);
    const ver = () => { nada.hidden = !!lista.querySelector('.nx-semana__rango'); };
    const agregar = (desde = '09:00', hasta = '18:00') => {
      const ini = el('input', { type: 'time', className: 'form-control form-control-sm', value: desde, required: true, ariaLabel: `${nombreDia}: desde` });
      const fin = el('input', { type: 'time', className: 'form-control form-control-sm', value: hasta, required: true, ariaLabel: `${nombreDia}: hasta` });
      const fila = el('span', { className: 'nx-semana__rango' }, ini, '–', fin,
        el('button', { type: 'button', className: 'nx-act nx-act--danger', title: 'Quitar rango', ariaLabel: `Quitar rango del ${nombreDia.toLowerCase()}`, onclick: () => { fila.remove(); ver(); } }, icono('x')));
      fila.valor = () => ({ weekday: dia, starts: ini.value, ends: fin.value });
      lista.append(fila);
      ver();
    };
    rangos.filter(r => r.weekday === dia).forEach(r => agregar(hhmm(r.starts), hhmm(r.ends)));
    const nodo = el('div', { className: 'nx-semana__dia' }, el('b', { textContent: nombreDia }), lista,
      el('button', { type: 'button', className: 'nx-act', onclick: () => agregar() }, icono('plus'), ' Rango'));
    return { nodo, lista, agregar };
  });
  // Atajo: el lunes se repite de martes a viernes
  const repetir = el('button', { type: 'button', className: 'nx-act', onclick: () => {
    const lunes = [...dias[0].lista.querySelectorAll('.nx-semana__rango')].map(f => f.valor());
    dias.slice(1, 5).forEach(d => { d.lista.querySelectorAll('.nx-semana__rango').forEach(f => f.remove()); lunes.forEach(r => d.agregar(r.starts, r.ends)); });
  } }, icono('copy'), ' Repetir el lunes de martes a viernes');
  return {
    nodo: el('div', { className: 'nx-semana' }, ...dias.map(d => d.nodo), el('div', {}, repetir)),
    valor: () => dias.flatMap(d => [...d.lista.querySelectorAll('.nx-semana__rango')].map(f => f.valor())),
  };
}
const errorRangos = rs => rs.some(r => !r.starts || !r.ends || r.ends <= r.starts) ? 'Cada rango necesita una hora de término posterior a la de inicio.' : null;

// Administración → Horario: zona horaria, semana y feriados de la empresa (admin de la empresa)
async function horarioEmpresa() {
  cabecera(emp.name, 'Horario', 'Horario de atención de la empresa. Cada workspace puede darle a un agente su propio horario y guardias.');
  const c = byId('contenido');
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  const [cs, ch, hd] = await Promise.all([
    sb.from('company_settings').select('*').eq('company_id', emp.company_id).maybeSingle(),
    sb.from('company_hours').select('*').eq('company_id', emp.company_id),
    sb.from('holidays').select('*').eq('company_id', emp.company_id).is('workspace_id', null).order('day')]);
  if (!c.isConnected) return;
  const zonaActual = cs.data?.timezone ?? 'America/Santiago';
  const zonas = Intl.supportedValuesOf?.('timeZone') ?? [zonaActual];
  const zona = sel((zonas.includes(zonaActual) ? zonas : [zonaActual, ...zonas]).map(z => [z, z.replace(/_/g, ' ')]), zonaActual, { style: 'max-width:320px' });
  const semana = editorSemana(ch.data ?? []);
  const err = errP(), btn = boton('Guardar horario', 'floppy-disk');
  btn.onclick = () => {
    const rangos = semana.valor();
    err.textContent = errorRangos(rangos) ?? '';
    if (!err.textContent) guardar(btn, err, () => sb.rpc('set_company_hours', { p_company: emp.company_id, p_timezone: zona.value, p_hours: rangos }), 'Horario guardado.');
  };
  c.replaceChildren(el('div', { style: 'display:grid;gap:24px' },
    panel('Horario semanal', 'Sin ningún rango, todos cuentan como en turno siempre. Un día sin rangos es un día que la empresa no atiende.',
      campo('Zona horaria', zona), semana.nodo, el('div', { className: 'nx-row' }, btn), err),
    panelFeriados(hd.data ?? [], null, 'Feriados de la empresa', 'Aplican a todos los workspaces que los consideren (Administración → Ajustes de atención).')));
}

// Lista de feriados con alta y baja. workspaceId null = de la empresa
function panelFeriados(filas, workspaceId, titulo, bajada, soloLectura = []) {
  const err = errP();
  const dia = el('input', { type: 'date', className: 'form-control', required: true });
  const nombreIn = el('input', { className: 'form-control', required: true, maxLength: 80, placeholder: 'Por ejemplo Fiestas Patrias' });
  const btn = boton('Agregar', 'plus');
  btn.onclick = () => dia.reportValidity() && nombreIn.reportValidity() && guardar(btn, err,
    () => sb.from('holidays').insert({ company_id: emp.company_id, workspace_id: workspaceId, day: dia.value, name: nombreIn.value.trim() }), 'Feriado agregado.');
  const linea = (h, borrar) => el('li', { className: 'nx-line' },
    el('div', {}, el('b', { textContent: h.name }), el('small', { textContent: fechaDia(h.day) + (borrar ? '' : ' · de la empresa') })),
    borrar ? quitar(() => sb.from('holidays').delete().eq('id', h.id), err, 'Feriado quitado.') : el('span'));
  const todas = [...soloLectura.map(h => [h, false]), ...filas.map(h => [h, true])].sort((a, b) => a[0].day.localeCompare(b[0].day));
  return panel(titulo, bajada,
    todas.length ? el('ul', { className: 'nx-lines' }, ...todas.map(([h, b]) => linea(h, b))) : el('p', { className: 'nx-faint', textContent: 'Sin feriados.' }),
    el('div', { className: 'nx-row' }, campo('Fecha', dia), campo('Nombre', nombreIn), btn), err);
}

// Configuración del workspace → Feriados: los de la empresa (solo lectura) más los propios
async function cfgFeriados(w, c) {
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  const { data } = await sb.from('holidays').select('*').eq('company_id', w.company_id).order('day');
  if (!c.isConnected) return;
  const propios = (data ?? []).filter(h => h.workspace_id === w.id), empresa = (data ?? []).filter(h => !h.workspace_id);
  c.replaceChildren(panelFeriados(propios, w.id, 'Feriados',
    `${w.holidays_enabled ? 'Se consideran' : 'Hoy no se consideran (actívalos en Administración → Ajustes de atención)'}: ese día nadie está en turno salvo quien tenga guardia. Los de la empresa los agrega su admin en Administración → Horario.`,
    empresa));
}

// Horario propio y guardias de una persona del equipo (owner o admin de la empresa)
function horarioPersona(w, uid, propias, guardias) {
  const err = errP();
  const usaEmpresa = el('input', { type: 'checkbox', className: 'form-check-input', checked: !propias.length });
  const semana = editorSemana(propias);
  const ver = () => { semana.nodo.hidden = usaEmpresa.checked; };
  usaEmpresa.onchange = ver;
  ver();
  const dia = el('input', { type: 'date', className: 'form-control form-control-sm', required: true });
  const desde = el('input', { type: 'time', className: 'form-control form-control-sm', value: '09:00', required: true });
  const hasta = el('input', { type: 'time', className: 'form-control form-control-sm', value: '14:00', required: true });
  const nota = el('input', { className: 'form-control form-control-sm', maxLength: 120, placeholder: 'Por ejemplo Guardia de feriado' });
  const errG = errP();
  const reabrir = async () => {
    const [h, g] = await Promise.all([sb.from('staff_hours').select('*').eq('workspace_id', w.id).eq('user_id', uid),
      sb.from('staff_guards').select('*').eq('workspace_id', w.id).eq('user_id', uid).order('day')]);
    horarioPersona(w, uid, h.data ?? [], g.data ?? []);
  };
  const agregarG = el('button', { type: 'button', className: 'btn btn-sm btn-outline-secondary' }, icono('plus'), ' Agregar guardia');
  agregarG.onclick = async () => {
    errG.textContent = '';
    if (![dia, desde, hasta].every(x => x.reportValidity())) return;
    if (hasta.value <= desde.value) { errG.textContent = 'La guardia debe terminar después de empezar.'; return; }
    const { error } = await ocupado(agregarG, () => sb.from('staff_guards').insert({ workspace_id: w.id, user_id: uid, day: dia.value, starts: desde.value, ends: hasta.value, note: nota.value.trim() || null }));
    if (error) { errG.textContent = error.message; return; }
    reabrir();
  };
  const hoy = new Date().toISOString().slice(0, 10);
  const listaG = guardias.filter(g => g.day >= hoy);
  const btn = el('button', { className: 'btn btn-primary' }, icono('floppy-disk'), ' Guardar horario');
  dialogo(nombre(uid), 'Horario y guardias', true,
    el('div', { className: 'nx-fields' },
      el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Horario semanal' }),
        el('label', { className: 'nx-check' }, usaEmpresa, 'Usar el horario de la empresa'), semana.nodo),
      el('div', { className: 'nx-field nx-field--full' }, el('span', { textContent: 'Guardias' }),
        el('small', { textContent: 'Turnos de una fecha puntual, aparte del horario semanal: valen aunque sea feriado.' }),
        listaG.length ? el('ul', { className: 'nx-lines' }, ...listaG.map(g => el('li', { className: 'nx-line' },
          el('div', {}, el('b', {}, el('span', { className: 'nx-chip k-info', textContent: 'Guardia' }), ` ${fechaDia(g.day)}`),
            el('small', { textContent: `${hhmm(g.starts)}–${hhmm(g.ends)}${g.note ? ` · ${g.note}` : ''}` })),
          el('button', { type: 'button', className: 'nx-act nx-act--danger', title: 'Quitar guardia', ariaLabel: 'Quitar guardia',
            onclick: async () => { await sb.from('staff_guards').delete().eq('id', g.id); reabrir(); } }, icono('x')))))
          : el('p', { className: 'nx-faint', style: 'margin:0', textContent: 'Sin guardias próximas.' }),
        el('div', { className: 'nx-row' }, campo('Fecha', dia), campo('Desde', desde), campo('Hasta', hasta), campo('Nota', nota), agregarG), errG)),
    pie(err, btn));
  frm.onsubmit = async e => {
    e.preventDefault();
    err.textContent = '';
    const rangos = usaEmpresa.checked ? null : semana.valor();
    if (rangos && (err.textContent = errorRangos(rangos) ?? '')) return;
    const { error } = await ocupado(btn, () => sb.rpc('set_staff_hours', { p_ws: w.id, p_user: uid, p_hours: rangos }));
    if (error) { err.textContent = error.message; return; }
    dlg.close();
    toast('Horario guardado.');
    navegar();
  };
}

// Configuración del workspace → Equipo: una tarjeta por persona con sus roles, si también atiende, si está activa y su horario
async function cfgEquipo(w, c) {
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  const [h, g] = await Promise.all([sb.from('staff_hours').select('*').eq('workspace_id', w.id), sb.from('staff_guards').select('*').eq('workspace_id', w.id)]);
  if (!c.isConnected) return;
  const filas = equipo.filter(s => s.workspace_id === w.id);
  const personas = [...new Set(filas.map(s => s.user_id))].sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'));
  const hoy = new Date().toISOString().slice(0, 10);
  const err = errP();
  const persona = sel([['', 'Elige una persona…'], ...gente], '');
  const rol = sel(ROLES.map(r => [r, texto(r)]), 'agent');
  const alcance = sel(opcionesCat(w.id, 'Todo el workspace'), '');
  const atiendeIn = el('input', { type: 'checkbox', className: 'form-check-input' });
  const cAtiende = el('label', { className: 'nx-check' }, atiendeIn, 'También atiende tickets');
  const verRol = () => { alcance.disabled = rol.value === 'owner'; if (alcance.disabled) alcance.value = ''; cAtiende.hidden = rol.value === 'agent'; };
  rol.onchange = verRol;
  verRol();
  const btn = boton('Agregar', 'user-plus');
  btn.onclick = () => persona.value && guardar(btn, err, () => sb.from('workspace_staff').insert({
    workspace_id: w.id, user_id: persona.value, role: rol.value, category_id: alcance.value || null, attends: rol.value === 'agent' || atiendeIn.checked }), 'Equipo actualizado.');
  const tarjeta = uid => {
    const suyas = filas.filter(s => s.user_id === uid).sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
    const atiende = suyas.some(s => s.attends);
    const activo = suyas.every(s => s.active);
    const propias = (h.data ?? []).filter(x => x.user_id === uid), guardias = (g.data ?? []).filter(x => x.user_id === uid && x.day >= hoy);
    const activoIn = el('input', { type: 'checkbox', className: 'form-check-input', role: 'switch', checked: activo, disabled: !atiende,
      onchange: e => guardar(e.target, err, () => sb.from('workspace_staff').update({ active: e.target.checked }).eq('workspace_id', w.id).eq('user_id', uid),
        e.target.checked ? `${nombre(uid)} vuelve a recibir tickets.` : `${nombre(uid)} queda inactivo: no recibe asignaciones.`) });
    return el('li', { className: `nx-persona ${atiende && !activo ? 'is-off' : ''}` },
      el('div', { className: 'nx-persona__head' },
        el('b', { textContent: nombre(uid) }),
        atiende ? el('label', { className: 'nx-check' }, activoIn, activo ? 'Activo' : 'Inactivo (vacaciones, licencia…)') : el('span', { className: 'nx-faint', textContent: 'No atiende tickets' }),
        atiende && el('button', { type: 'button', className: 'nx-act', onclick: () => horarioPersona(w, uid, propias, guardias) },
          icono('clock'), ` ${propias.length ? 'Horario propio' : 'Horario de la empresa'}${guardias.length ? ` · ${guardias.length} guardia${guardias.length > 1 ? 's' : ''}` : ''}`)),
      el('ul', { className: 'nx-lines' }, ...suyas.map(s => el('li', { className: 'nx-line' },
        el('div', {}, el('span', {}, texto(s.role), el('small', { style: 'display:inline', textContent: ` · ${s.category_id ? ruta(s.category_id) : 'Todo el workspace'}` }))),
        el('span', { className: 'nx-rowact' },
          s.role !== 'agent' && el('label', { className: 'nx-check nx-check--sm' }, el('input', { type: 'checkbox', className: 'form-check-input', checked: s.attends,
            onchange: e => guardar(e.target, err, () => sb.from('workspace_staff').update({ attends: e.target.checked }).eq('id', s.id), 'Equipo actualizado.') }), 'También atiende'),
          quitar(() => sb.from('workspace_staff').delete().eq('id', s.id), err, 'Quitado del equipo.'))))));
  };
  c.replaceChildren(panel('Equipo',
    'Owner: administra el workspace. Supervisor: gestiona los tickets de su alcance. Agente: atiende su alcance. Owner y supervisor pueden además atender tickets. Quien atiende puede quedar inactivo (vacaciones, licencia) y no recibe asignaciones. Cada persona ocupa un cupo del plan.',
    personas.length ? el('ul', { className: 'nx-personas' }, ...personas.map(tarjeta)) : el('p', { className: 'nx-faint', textContent: 'Todavía no hay equipo. Agrega al menos un owner.' }),
    el('div', { className: 'nx-row' }, campo('Persona', persona), campo('Rol', rol), campo('Alcance', alcance), cAtiende, btn), err));
}

// ── Gestión → Análisis de datos: métricas, revisión y configuración del SLA ──
// Los números los calcula ticketeasy.workspace_analytics (solo para quien gestiona el workspace); el reloj del SLA
// cuenta minutos hábiles del agente asignado y se detiene en las esperas (ver la migración sla_y_analisis)
let rangoAnalisis = 30;   // días hacia atrás, o { desde, hasta }
const minutos = m => m == null ? '—' : m < 60 ? `${Math.round(m)} min` : m < 60 * 48 ? `${(m / 60).toLocaleString('es-CL', { maximumFractionDigits: 1 })} h` : `${(m / 60 / 24).toLocaleString('es-CL', { maximumFractionDigits: 1 })} días`;
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
const diaLocal = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
// Medidor de cumplimiento: estado con ícono y texto (nunca solo color)
function medidor(met, medidos) {
  const p = pct(met, medidos);
  if (p == null) return el('span', { className: 'nx-faint', textContent: 'Sin datos' });
  const [k, ic] = p >= 90 ? ['ok', 'check-circle'] : p >= 75 ? ['warn', 'warning'] : ['bad', 'warning-octagon'];
  return el('span', { className: `nx-meter k-${k}`, title: `${met} de ${medidos} dentro de la meta` },
    el('span', { className: 'nx-meter__track' }, el('span', { className: 'nx-meter__fill', style: `width:${p}%` })),
    el('span', { className: 'nx-meter__val' }, icono(ic), ` ${p}%`));
}
// Columnas de una serie (tickets creados por día) con tooltip por columna y su tabla
function columnasPorDia(dias) {
  const max = Math.max(1, ...dias.map(d => d.created));
  const tope = Math.max(2, Math.ceil(max / 2) * 2);   // par: la marca del medio es un entero exacto
  const tip = el('div', { className: 'nx-chart__tip', hidden: true });
  const fmt = d => new Date(`${d}T12:00:00`).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' });
  const cols = dias.map(d => {
    const col = el('button', { type: 'button', className: 'nx-chart__col', ariaLabel: `${fmt(d.day)}: ${d.created} creados, ${d.resolved} resueltos` },
      el('span', { className: 'nx-chart__bar', style: `height:${d.created / tope * 100}%` }));
    const ver = () => { tip.replaceChildren(el('b', { textContent: `${d.created} creados` }), el('span', { textContent: `${d.resolved} de ellos ya resueltos` }), el('small', { textContent: fmt(d.day) })); tip.hidden = false; tip.style.left = `${col.offsetLeft + col.offsetWidth / 2}px`; };
    col.onpointerenter = ver; col.onfocus = ver;
    col.onpointerleave = col.onblur = () => { tip.hidden = true; };
    return col;
  });
  const marcas = [tope, tope / 2, 0].map(v => el('span', { textContent: Math.round(v).toLocaleString('es-CL') }));
  const cada = Math.max(1, Math.ceil(dias.length / 8));
  return el('div', { className: 'nx-chart' },
    el('div', { className: 'nx-chart__plot' }, el('div', { className: 'nx-chart__y' }, ...marcas), el('div', { className: 'nx-chart__cols' }, ...cols, tip)),
    el('div', { className: 'nx-chart__x' }, ...dias.map((d, i) => el('span', { textContent: i % cada === 0 ? fmt(d.day) : '' }))),
    el('details', { className: 'nx-chart__tabla' }, el('summary', { textContent: 'Ver como tabla' }),
      el('table', { className: 'table table-sm nx-table' }, el('thead', {}, el('tr', {}, el('th', { textContent: 'Día' }), el('th', { textContent: 'Creados' }), el('th', { textContent: 'Resueltos' }))),
        el('tbody', {}, ...dias.filter(d => d.created).map(d => el('tr', {}, el('td', { textContent: fmt(d.day) }), el('td', { className: 'num', textContent: d.created }), el('td', { className: 'num', textContent: d.resolved })))))));
}

async function vistaAnalisis() {
  const w = ws(wsAct);
  cabecera(w.name, 'Análisis de datos', 'Tickets creados en el período: volumen, tiempos, SLA, equipo y satisfacción.');
  const c = byId('contenido');
  const hoy = new Date();
  const [desde, hasta] = typeof rangoAnalisis === 'number'
    ? [diaLocal(new Date(hoy.getTime() - (rangoAnalisis - 1) * 864e5)), diaLocal(hoy)] : [rangoAnalisis.desde, rangoAnalisis.hasta];
  // Filtros en una fila, arriba de todo: atajos y rango propio
  const dIn = el('input', { type: 'date', className: 'form-control form-control-sm', value: desde, ariaLabel: 'Desde' });
  const hIn = el('input', { type: 'date', className: 'form-control form-control-sm', value: hasta, ariaLabel: 'Hasta' });
  const aplicar = el('button', { type: 'button', className: 'btn btn-sm btn-outline-secondary', textContent: 'Aplicar',
    onclick: () => { if (dIn.value && hIn.value && dIn.value <= hIn.value) { rangoAnalisis = { desde: dIn.value, hasta: hIn.value }; vistaAnalisis(); } } });
  const filtros = el('div', { className: 'nx-filters nx-analisis__filtros' },
    ...[[7, 'Últimos 7 días'], [30, 'Últimos 30 días'], [90, 'Últimos 90 días']].map(([n, l]) => el('button', {
      className: 'nx-filter', ariaPressed: String(rangoAnalisis === n), onclick: () => { rangoAnalisis = n; vistaAnalisis(); } }, l)),
    el('span', { className: 'nx-analisis__rango' }, dIn, '–', hIn, aplicar));
  const previo = c.querySelector('.nx-analisis');
  if (previo) previo.style.opacity = .5; else c.replaceChildren(filtros, el('p', { className: 'nx-loading', textContent: 'Calculando…' }));
  const [{ data: a, error }, { data: metas }] = await Promise.all([
    sb.rpc('workspace_analytics', { p_ws: w.id, p_from: desde, p_to: hasta }),
    sb.from('sla_targets').select('*').eq('workspace_id', w.id)]);
  if (!c.isConnected || ws(wsAct) !== w) return;
  if (error) { c.replaceChildren(filtros, el('p', { className: 'nx-error', textContent: error.message })); return; }
  const t = a.totals;
  const tile = (l, v, sub) => el('div', { className: 'nx-tile' }, el('b', { textContent: v }), el('span', { textContent: l }), sub && el('small', { className: 'nx-faint', textContent: sub }));
  const indicadores = el('div', { className: 'nx-tiles' },
    tile('Creados', t.created.toLocaleString('es-CL')), tile('Resueltos', t.resolved.toLocaleString('es-CL')), tile('Abiertos', t.open.toLocaleString('es-CL')),
    tile('Cancelados', t.cancelled.toLocaleString('es-CL')),
    tile('Primera respuesta', minutos(t.avg_first_response), 'promedio, en horas hábiles'), tile('Resolución', minutos(t.avg_resolution), 'promedio, en horas hábiles'),
    tile('Satisfacción', t.rating_count ? `${String(t.rating_avg).replace('.', ',')} ★` : '—', t.rating_count ? `${t.rating_count} calificaciones` : 'sin calificaciones'));

  // SLA: revisión (cumplimiento y riesgo) y configuración
  const sla = a.sla_enabled
    ? panel('SLA', 'Porcentaje de tickets dentro de la meta de su prioridad. Cuenta horas hábiles del agente asignado y se detiene en las esperas.',
      el('div', { className: 'nx-sla__resumen' },
        el('div', {}, el('span', { textContent: 'Primera respuesta' }), medidor(t.fr_met, t.fr_measured)),
        el('div', {}, el('span', { textContent: 'Resolución' }), medidor(t.rs_met, t.rs_measured))),
      el('div', { className: 'table-responsive' }, el('table', { className: 'table nx-table' },
        el('thead', {}, el('tr', {}, ...['Prioridad', 'Creados', 'Primera respuesta', 'Resolución', 'Resolución promedio'].map(x => el('th', { textContent: x })))),
        el('tbody', {}, ...a.by_priority.map(p => el('tr', {}, el('td', {}, chip(p.priority)), el('td', { className: 'num', textContent: p.created }),
          el('td', {}, medidor(p.fr_met, p.fr_measured)), el('td', {}, medidor(p.rs_met, p.rs_measured)), el('td', { className: 'num', textContent: minutos(p.avg_resolution) })))))))
    : panel('SLA', 'El SLA está apagado en este workspace. Actívalo y fija las metas abajo para ver el cumplimiento.');
  const riesgo = a.sla_enabled && panel('Revisión: tickets en riesgo', 'Abiertos que ya usaron el 75% o más de su meta, del más comprometido al menos.',
    a.at_risk.length ? el('div', { className: 'table-responsive' }, el('table', { className: 'table nx-table' },
      el('thead', {}, el('tr', {}, ...['#', 'Asunto', 'Estado', 'Prioridad', 'Meta', 'Usado', 'Asignado'].map(x => el('th', { textContent: x })))),
      el('tbody', {}, ...a.at_risk.slice(0, 25).map(r => el('tr', { className: 'nx-row--link', onclick: () => abrir(r.id) },
        el('td', { className: 'mono nx-faint', textContent: r.id }),
        el('td', {}, el('button', { className: 'nx-name', title: r.subject, textContent: r.subject, onclick: () => abrir(r.id) })),
        el('td', {}, chip(r.status)), el('td', {}, chip(r.priority)),
        el('td', { textContent: `${r.metric === 'first_response' ? 'Primera respuesta' : 'Resolución'}: ${minutos(r.target)}` }),
        el('td', {}, el('span', { className: `nx-chip k-${r.used >= 1 ? 'bad' : 'warn'}` }, icono(r.used >= 1 ? 'warning-octagon' : 'warning'), ` ${r.used >= 1 ? 'Vencido' : 'En riesgo'} · ${Math.round(r.used * 100)}%`)),
        el('td', { textContent: nombre(r.assignee_id) })))))) : el('p', { className: 'nx-faint', textContent: 'Ningún ticket abierto está cerca de vencer.' }));

  const porAgente = panel('Por agente', 'Tickets del período según su asignado actual.',
    el('div', { className: 'table-responsive' }, el('table', { className: 'table nx-table' },
      el('thead', {}, el('tr', {}, ...['Asignado', 'Tickets', 'Abiertos', 'Resueltos', 'Resolución promedio', a.sla_enabled && 'SLA de resolución', 'Satisfacción'].filter(Boolean).map(x => el('th', { textContent: x })))),
      el('tbody', {}, ...a.by_agent.map(g => el('tr', {}, el('td', { textContent: g.user_id ? nombre(g.user_id) : 'Sin asignar' }),
        el('td', { className: 'num', textContent: g.assigned }), el('td', { className: 'num', textContent: g.open }), el('td', { className: 'num', textContent: g.resolved }),
        el('td', { className: 'num', textContent: minutos(g.avg_resolution) }), a.sla_enabled && el('td', {}, medidor(g.rs_met, g.rs_measured)),
        el('td', { className: 'num', textContent: g.rating_avg ? `${String(g.rating_avg).replace('.', ',')} ★` : '—' })))))));

  // Satisfacción: estrellas (barras horizontales de una serie) y etiquetas más elegidas
  const totalNotas = Object.values(a.ratings).reduce((x, y) => x + y, 0);
  const satisfaccion = panel('Satisfacción', totalNotas ? `${totalNotas} calificaciones en el período.` : 'Sin calificaciones en el período (la encuesta se activa en Administración → Ajustes de atención).',
    totalNotas ? el('div', { className: 'nx-hbars' }, ...[5, 4, 3, 2, 1].map(n => {
      const v = a.ratings[n] ?? 0;
      return el('div', { className: 'nx-hbars__fila', title: `${v} con ${n} estrella${n > 1 ? 's' : ''}` },
        el('span', { textContent: `${n} ★` }), el('span', { className: 'nx-hbars__track' }, el('span', { className: 'nx-hbars__bar', style: `width:${v / totalNotas * 100}%` })),
        el('span', { className: 'num', textContent: v }));
    })) : null,
    Object.keys(a.tags).length ? el('div', { className: 'nx-chips' }, ...Object.entries(a.tags).sort((x, y) => y[1] - x[1]).map(([k, n]) =>
      el('span', { className: 'nx-chip k-muted', textContent: `${textoEtiqueta[k] ?? k} · ${n}` }))) : null);

  // Configuración del SLA: metas por prioridad en horas hábiles
  const PREDEF = { urgent: [1, 8], high: [4, 24], medium: [8, 48], low: [24, 120] };
  const slaOn = el('input', { type: 'checkbox', className: 'form-check-input', checked: a.sla_enabled });
  const entradas = ['urgent', 'high', 'medium', 'low'].map(p => {
    const m = (metas ?? []).find(x => x.priority === p);
    const fr = el('input', { type: 'number', className: 'form-control form-control-sm', min: 0.25, step: 0.25, required: true, value: m ? m.first_response_minutes / 60 : PREDEF[p][0], ariaLabel: `${texto(p)}: primera respuesta en horas` });
    const rs = el('input', { type: 'number', className: 'form-control form-control-sm', min: 0.25, step: 0.25, required: true, value: m ? m.resolution_minutes / 60 : PREDEF[p][1], ariaLabel: `${texto(p)}: resolución en horas` });
    return { p, fr, rs };
  });
  const err = errP(), btn = boton('Guardar SLA', 'floppy-disk');
  btn.onclick = () => entradas.every(e => e.fr.reportValidity() && e.rs.reportValidity()) && guardar(btn, err, () => sb.rpc('set_sla', {
    p_ws: w.id, p_enabled: slaOn.checked,
    p_targets: entradas.map(e => ({ priority: e.p, first_response_minutes: Math.round(e.fr.value * 60), resolution_minutes: Math.round(e.rs.value * 60) })) }), 'SLA guardado.');
  const config = escribe() && panel('Configuración del SLA', 'Metas por prioridad, en horas hábiles del agente asignado (su horario, guardias y feriados). El reloj se detiene en Pendiente de respuesta y En espera de terceros.',
    el('label', { className: 'nx-check' }, slaOn, 'Medir el SLA en este workspace'),
    el('div', { className: 'table-responsive' }, el('table', { className: 'table nx-table nx-sla__metas' },
      el('thead', {}, el('tr', {}, el('th', { textContent: 'Prioridad' }), el('th', { textContent: 'Primera respuesta (h)' }), el('th', { textContent: 'Resolución (h)' }))),
      el('tbody', {}, ...entradas.map(e => el('tr', {}, el('td', {}, chip(e.p)), el('td', {}, e.fr), el('td', {}, e.rs)))))),
    el('div', { className: 'nx-row' }, btn), err);

  c.replaceChildren(filtros, el('div', { className: 'nx-analisis' }, indicadores,
    panel('Tickets creados por día', null, columnasPorDia(a.by_day)),
    sla, riesgo, porAgente, satisfaccion, config));
}

// ── Comunicados del workspace ───────────────────────────────────────────
// La RLS ya filtra: quien no publica solo recibe los vigentes. Quien publica recibe todos y aquí se filtran
const estadoAviso = (a, ahora = new Date()) => !a.is_active ? 'Oculto' : new Date(a.starts_at) > ahora ? 'Programado'
  : a.ends_at && new Date(a.ends_at) <= ahora ? 'Vencido' : 'Vigente';
const ventana = a => `Desde ${fecha(a.starts_at)} ${a.ends_at ? `hasta ${fecha(a.ends_at)}` : 'sin vencimiento'}`;
const aLocal = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);   // para <input type="datetime-local">
const GRAVEDAD = ['danger', 'warning', 'info'];
let avisoTimer, rotaTimer;
// Barra de una línea arriba de cada página menos Inicio: los comunicados vigentes de toda la empresa, rotando.
// Lleva a Inicio, donde se leen completos
async function pintarAvisos(mostrar) {
  const caja = byId('avisos');
  clearTimeout(avisoTimer);
  clearInterval(rotaTimer);
  if (!mostrar || !wss.length) { caja.replaceChildren(); return; }
  const deEmp = emp.company_id;
  const { data } = await sb.from('announcements').select('*').in('workspace_id', wss.map(w => w.id));
  if (deEmp !== emp.company_id) return;
  const ahora = new Date();
  const todos = data ?? [];
  const activos = vigentesDe(todos, ahora);
  programarAvisos(todos, ahora, () => pintarAvisos(true));
  if (!activos.length) { caja.replaceChildren(); return; }
  const ico = el('span', { className: 'nx-avisobar__ico' }), txt = el('span', { className: 'nx-avisobar__txt' });
  const cuenta = activos.length > 1 && el('span', { className: 'nx-avisobar__n num' });
  const barra = el('a', { href: '#/', className: 'nx-avisobar', ariaLabel: `Comunicados activos (${activos.length}). Ver en Inicio` }, ico, txt, cuenta);
  let i = 0;
  const mostrarUno = () => {
    const a = activos[i];
    const linea = [ws(a.workspace_id)?.name, [a.title, a.message].filter(Boolean).join(' — ')].filter(Boolean).join(' · ');
    barra.className = `nx-avisobar k-${TONO[a.severity]}`;
    ico.replaceChildren(icono(ICONO_AVISO[a.severity]));
    txt.textContent = linea;
    barra.title = linea;
    if (cuenta) cuenta.textContent = `${i + 1}/${activos.length}`;
  };
  const rotar = () => { clearInterval(rotaTimer); if (activos.length > 1) rotaTimer = setInterval(() => { i = (i + 1) % activos.length; mostrarUno(); }, 6000); };
  barra.onmouseenter = barra.onfocus = () => clearInterval(rotaTimer);
  barra.onmouseleave = barra.onblur = rotar;
  mostrarUno();
  rotar();
  caja.replaceChildren(barra);
}
const vigentesDe = (todos, ahora) => todos.filter(a => estadoAviso(a, ahora) === 'Vigente')
  .sort((a, b) => GRAVEDAD.indexOf(a.severity) - GRAVEDAD.indexOf(b.severity) || new Date(b.starts_at) - new Date(a.starts_at));
// Sin recargar: vuelve a pintar cuando uno empieza o vence (dentro de las próximas 24 h)
function programarAvisos(todos, ahora, repintar) {
  const proximo = Math.min(...todos.flatMap(a => [a.starts_at, a.ends_at]).filter(Boolean).map(t => new Date(t) - ahora).filter(ms => ms > 0 && ms < 864e5));
  if (isFinite(proximo)) avisoTimer = setTimeout(repintar, proximo + 1000);
}
// Tarjeta de un comunicado: indica el workspace que lo publica
function tarjetaAviso(a) {
  const w = ws(a.workspace_id);
  return el('div', { className: `nx-aviso k-${TONO[a.severity]}`, role: a.severity === 'danger' ? 'alert' : 'status' },
    icono(ICONO_AVISO[a.severity]),
    el('div', {},
      w && el('span', { className: 'nx-aviso__ws' }, insignia(w.logo_url, w.name), el('span', { textContent: w.name })),
      a.title && el('b', { textContent: a.title }), el('p', { textContent: a.message }),
      el('small', { textContent: [a.ends_at && `Hasta ${fecha(a.ends_at)}`, a.created_by && nombre(a.created_by)].filter(Boolean).join(' · ') })));
}

async function cfgComunicados(w, c) {
  c.replaceChildren(el('p', { className: 'nx-loading', textContent: 'Cargando…' }));
  const { data, error } = await sb.from('announcements').select('*').eq('workspace_id', w.id).order('starts_at', { ascending: false });
  if (!c.isConnected) return;   // se cambió de vista mientras cargaba
  const err = errP();
  if (error) { err.textContent = error.message; c.replaceChildren(err); return; }
  const titulo = el('input', { className: 'form-control', maxLength: 80, placeholder: 'Por ejemplo: Correo con intermitencia' });
  const mensaje = el('textarea', { className: 'form-control', rows: 3, required: true, maxLength: 280, placeholder: 'Qué pasa, a quién afecta y qué hacer mientras tanto.' });
  const severidad = sel(['info', 'warning', 'danger'].map(x => [x, texto(x)]), 'info');
  const desde = el('input', { type: 'datetime-local', className: 'form-control', required: true, value: aLocal(new Date()) });
  const hasta = el('input', { type: 'datetime-local', className: 'form-control' });
  const btn = boton('Publicar', 'megaphone');
  btn.onclick = () => {
    err.textContent = '';
    if (![mensaje, desde, hasta].every(x => x.reportValidity())) return;
    if (hasta.value && new Date(hasta.value) <= new Date(desde.value)) { err.textContent = '«Hasta» debe ser posterior a «Desde».'; return; }
    guardar(btn, err, () => sb.from('announcements').insert({ workspace_id: w.id, created_by: yo, title: titulo.value.trim() || null, message: mensaje.value.trim(),
      severity: severidad.value, starts_at: new Date(desde.value).toISOString(), ends_at: hasta.value ? new Date(hasta.value).toISOString() : null }), 'Comunicado publicado.');
  };
  const errL = errP();
  const accion = (ic, t, fn) => { const b = el('button', { type: 'button', className: 'nx-act', title: t, ariaLabel: t }, icono(ic)); b.onclick = () => fn(b); return b; };
  const filas = data ?? [];
  c.replaceChildren(el('div', { style: 'display:grid;gap:24px' },
    panel('Nuevo comunicado', 'Aparece como aviso arriba de Inicio, Tickets y Gestión para todas las personas que pueden abrir tickets en este workspace, mientras esté vigente.',
      el('div', { className: 'nx-fields', style: 'padding:0' },
        campo('Título (opcional)', titulo),
        campo('Severidad', severidad, { hint: 'Crítico: caída o incidente mayor. Advertencia: mantención o degradación. Información: novedades.' }),
        campo('Mensaje', mensaje, { full: true, hint: 'Hasta 280 caracteres.' }),
        campo('Desde', desde), campo('Hasta (opcional)', hasta, { hint: 'Pasada esta fecha deja de mostrarse.' })),
      el('div', { className: 'nx-row' }, btn), err),
    panel('Publicados', null,
      filas.length ? el('ul', { className: 'nx-lines' }, ...filas.map(a => {
        const estado = estadoAviso(a);
        return el('li', { className: 'nx-line nx-line--aviso', title: [a.title, a.message].filter(Boolean).join(' — ') },
          el('div', { className: ['Vigente', 'Programado'].includes(estado) ? '' : 'is-off' },
            el('b', {}, chip(a.severity), ' ', a.title ?? a.message),
            el('small', { textContent: [a.title && a.message, `${estado} · ${ventana(a)}`, a.created_by && `Publicó ${nombre(a.created_by)}`].filter(Boolean).join(' · ') })),
          el('span', { className: 'nx-rowact' },
            accion(a.is_active ? 'eye-slash' : 'eye', a.is_active ? 'Ocultar' : 'Mostrar',
              b => guardar(b, errL, () => sb.from('announcements').update({ is_active: !a.is_active }).eq('id', a.id), a.is_active ? 'Comunicado oculto.' : 'Comunicado visible.')),
            quitar(() => sb.from('announcements').delete().eq('id', a.id), errL, 'Comunicado eliminado.')));
      })) : el('p', { className: 'nx-faint', textContent: 'Aún no hay comunicados.' }),
      errL)));
}

// Límite de workspaces del plan (ticketeasy.workspace_quota). Al alcanzarlo, la ventana; si no, true
async function hayCupoWorkspace() {
  const { data } = await sb.rpc('workspace_quota', { p_company: emp.company_id });
  if (data?.limit == null || data.used < data.limit) return true;
  limiteAlcanzado(data.limit);
  return false;
}
function limiteAlcanzado(limite) {
  dialogo('Plan de TicketEasy', 'Alcanzaste tu límite, mejora tu plan', false,
    el('div', { className: 'nx-fields' }, el('p', { className: 'nx-field--full', style: 'margin:0' },
      limite ? `Tu plan permite ${limite} workspace${limite > 1 ? 's' : ''} y ya los tienes todos. Mejora tu plan para crear más.` : 'Tu plan no permite crear más workspaces. Mejora tu plan para crear más.')),
    el('div', { className: 'nx-dialog__foot' }, el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Entendido', onclick: () => dlg.close() })));
}

async function nuevoWorkspace() {
  if (!await hayCupoWorkspace()) { history.replaceState(null, '', '#/'); navegar(); return; }
  cabecera('Administración', 'Nuevo workspace', 'Un espacio de atención, por ejemplo TI, Personas o Finanzas. Después defines sus categorías, su equipo y quién puede abrir tickets.');
  const nombreIn = el('input', { className: 'form-control', required: true, minLength: 2, maxLength: 80, placeholder: 'TI' });
  const modo = sel([['open', 'Abierto: todos los miembros, menos la lista negra'], ['restricted', 'Restringido: solo la lista blanca']], 'open');
  const yoOwner = el('input', { type: 'checkbox', className: 'form-check-input', checked: true });
  const err = errP(), btn = boton('Crear workspace', 'plus');
  btn.onclick = async () => {
    if (!nombreIn.reportValidity()) return;
    err.textContent = '';
    const { data, error } = await ocupado(btn, () => sb.from('workspaces').insert({ company_id: emp.company_id, name: nombreIn.value.trim(), access_mode: modo.value }).select('id').single());
    if (error?.code === '23514' && /límite/.test(error.message)) { limiteAlcanzado(null); return; }   // otra persona ocupó el último cupo
    if (error) { err.textContent = error.code === '23505' ? 'Ya existe un workspace con ese nombre.' : error.message; return; }
    if (yoOwner.checked) {
      const r = await sb.from('workspace_staff').insert({ workspace_id: data.id, user_id: yo, role: 'owner' });
      if (r.error) toast(r.error.message, 'warning-circle');
    }
    toast('Workspace creado.');
    await cargarCatalogo();
    elegirWs(data.id);
    location.hash = '#/ws/categorias';
  };
  byId('contenido').replaceChildren(panel('Datos', null,
    el('div', { className: 'nx-row' }, campo('Nombre', nombreIn), campo('Quién puede abrir tickets', modo)),
    el('label', { className: 'nx-check' }, yoOwner, 'Agregarme como owner (ocupa un cupo del plan)'),
    el('div', { className: 'nx-row' }, btn), err));
  nombreIn.focus();
}

// Marca de la empresa: la comparten todas las apps de Nexus. La vista previa se aplica en vivo; al salir sin guardar se descarta
function panelMarca() {
  const m = emp.brand ?? {};
  const logo = el('input', { type: 'url', className: 'form-control', value: m.logo_url ?? '', placeholder: 'https://tuempresa.com/logo.svg', pattern: String.raw`https://\S+`, maxLength: 1500 });
  const primario = el('input', { type: 'color', className: 'form-control form-control-color', value: m.primario ?? '#b4532e' });
  const oscuro = el('input', { type: 'color', className: 'form-control form-control-color', value: m.oscuro ?? '#171310' });
  // Igual a Fractional IT = sin cambio: así la empresa sigue la marca por defecto (y su tema oscuro) si esta cambia
  const leer = () => ({ logo_url: logo.validity.valid && logo.value.trim() || null,
    primario: primario.value === '#b4532e' ? null : primario.value, oscuro: oscuro.value === '#171310' ? null : oscuro.value });
  [logo, primario, oscuro].forEach(x => x.oninput = () => aplicarMarca(leer()));
  const err = errP(), btn = boton('Guardar', 'floppy-disk'), volver = boton('Volver a la marca Fractional IT', 'arrow-counter-clockwise', false);
  const enviar = (b, marca) => guardar(b, err, async () => {
    const r = await nucleo.rpc('actualizar_marca', { p_empresa: emp.company_id, p_marca: marca });
    if (!r.error) emp.brand = JSON.parse(JSON.stringify(marca, (k, v) => v ?? undefined));
    return r;
  }, 'Marca actualizada.');
  btn.onclick = () => logo.reportValidity() && enviar(btn, leer());
  volver.onclick = () => enviar(volver, {});
  return panel('Marca', 'Logo y colores de la empresa, para todas sus personas y apps. Sin cambios se usa la marca Fractional IT. La vista previa se ve en esta misma pantalla.',
    el('div', { className: 'nx-row' }, campo('Logo (URL https)', logo, { hint: 'Se muestra sobre el color oscuro, en la barra lateral.' })),
    el('div', { className: 'nx-row' }, campo('Color principal', primario), campo('Color oscuro', oscuro)),
    el('div', { className: 'nx-row' }, btn, volver), err);
}

// Administración de la empresa (admin): nuevo workspace, horario, ajustes de atención, Ver como y marca
function administracion() {
  if (subAdmin === 'horario') return horarioEmpresa();
  if (subAdmin === 'ajustes') return wsAct ? vistaAjustes() : (cabecera(emp.name, 'Ajustes de atención', 'Elige un workspace en la barra lateral.'), byId('contenido').replaceChildren());
  if (subAdmin === 'ver-como') return wsAct ? vistaVerComo() : (cabecera(emp.name, 'Ver como', 'Elige un workspace en la barra lateral.'), byId('contenido').replaceChildren());
  cabecera(emp.name, 'Marca', null);
  byId('contenido').replaceChildren(panelMarca());
}

sesion();
