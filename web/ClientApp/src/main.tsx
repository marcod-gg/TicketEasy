// DataViews de TicketEasy: "Tickets", con alcances según el rol (ingresados por mí, asignados a mí, todos).
// La app (wwwroot/js/app.js) es JS sin framework: este build expone window.TicketTabla.montar(el, opciones) y
// app.js lo monta al entrar a la vista y lo desmonta al salir. Los datos, permisos y el cambio de estado los pone app.js
// (Supabase con RLS); aquí solo se arman campos, vistas por defecto y el montaje.
// Respuestas de la skill: se arrastra solo el estado, solo quien atiende el ticket y solo por el ciclo de vida
// (validateMove/onMove los da app.js); estilo de la página (tokens --fi-* en css/dataviews-tokens.css).
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataViews } from './dataviews/DataViews';
import { blankView } from './dataviews/useViews';
import type { Fields, FilterRule, Row, ViewConfig } from './dataviews/types';

export type Fuente = 'mine' | 'assigned' | 'all';

export interface Opciones {
  storageKey: string;
  categorias: string[]; // rutas "Padre / Hija" del workspace, en orden de árbol
  equipo: string[]; // nombres del equipo (para agrupar por asignado)
  fuentes: Fuente[]; // tickets: alcances que permite el rol, en orden de pestañas; la última es la que se abre la primera vez
  load: (source: string) => Promise<Row[]>;
  vistaInicial?: string; // id de una vista por defecto (los contadores de Inicio)
  validateMove?: (row: Row, value: string) => string | null;
  onMove?: (row: Row, value: string) => Promise<void>;
}

// Mismo orden que el ciclo de vida (PASOS en app.js)
const ESTADOS = [
  { value: 'Nuevo', color: 'var(--c-nuevo)', icon: 'fa-circle-plus' },
  { value: 'Clasificado', color: 'var(--c-pendiente)', icon: 'fa-tag' },
  { value: 'En curso', color: 'var(--c-curso)', icon: 'fa-play' },
  { value: 'Pendiente de respuesta', color: 'var(--c-espera)', icon: 'fa-comment-dots' },
  { value: 'En espera de terceros', color: 'var(--c-espera)', icon: 'fa-hourglass-half' },
  { value: 'Escalado', color: 'var(--c-danger)', icon: 'fa-arrow-up' },
  { value: 'Reabierto', color: 'var(--c-espera)', icon: 'fa-rotate-left' },
  { value: 'Resuelto', color: 'var(--c-resuelto)', icon: 'fa-circle-check' },
  { value: 'Cerrado', color: 'var(--c-total)', icon: 'fa-lock' },
  { value: 'Cancelado', color: 'var(--c-cancelado)', icon: 'fa-ban' },
];

function campos(o: Opciones): Fields {
  return {
    asunto: { label: 'Asunto', type: 'text', size: 320 },
    id: { label: 'N.º', type: 'number', size: 80, copy: true },
    estado: { label: 'Estado', type: 'select', size: 150, options: ESTADOS },
    prioridad: {
      label: 'Prioridad', type: 'select', size: 120, options: [
        { value: 'Urgente', color: 'var(--c-danger)', icon: 'fa-bolt' },
        { value: 'Alta', color: 'var(--c-espera)', icon: 'fa-angles-up' },
        { value: 'Media', color: 'var(--c-curso)', icon: 'fa-equals' },
        { value: 'Baja', color: 'var(--c-cancelado)', icon: 'fa-angles-down' },
      ],
    },
    tipo: {
      label: 'Tipo', type: 'select', size: 140, options: [
        { value: 'Incidente', icon: 'fa-triangle-exclamation' }, { value: 'Requerimiento', icon: 'fa-list-check' },
        { value: 'Consulta', icon: 'fa-circle-question' }, { value: 'Problema', icon: 'fa-bug' },
      ],
    },
    categoria: { label: 'Categoría', type: 'select', size: 220, options: o.categorias.map(value => ({ value, icon: 'fa-folder' })) },
    solicitante: { label: 'Solicitante', type: 'text', size: 170 },
    asignado: { label: 'Asignado', type: 'select', size: 170, options: o.equipo.map(value => ({ value, icon: 'fa-user' })) },
    creado: { label: 'Creado', type: 'date', size: 120 },
    movimiento: { label: 'Último movimiento', type: 'date', size: 150 },
  };
}

// Vistas iniciales con id fijo: Inicio abre una por su id (vistaInicial)
const vista = (id: string, name: string, type: ViewConfig['type'], filters: FilterRule[], extra: Partial<ViewConfig> = {}): ViewConfig =>
  ({ ...blankView(type, 'all', name), id, filters, sorting: [{ id: 'movimiento', desc: true }], ...extra });

function vistasPorDefecto(o: Opciones): ViewConfig[] {
  // Una vista por alcance del rol (el servidor ya limita lo que cada uno ve)
  return o.fuentes.map(f => ({
    mine: vista('ingresados', 'Ingresados por mí', 'table', [], { source: 'mine', hidden: { solicitante: false } }),
    assigned: vista('asignados', 'Asignados a mí', 'table', [], { source: 'assigned', hidden: { asignado: false } }),
    all: vista('todos_tickets', 'Todos los tickets', 'table', [], { source: 'all', groupBy: 'estado' }),
  })[f]);
}

// Deja activa la vista pedida (si existe en lo guardado o en las por defecto) antes de montar: useViews la lee al iniciar
function preferir(key: string, id: string | undefined, defaults: () => ViewConfig[]) {
  if (!id) return;
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? 'null') as { views?: ViewConfig[] } | null;
    const views = s?.views?.length ? s.views : defaults();
    if (views.some(v => v.id === id)) localStorage.setItem(key, JSON.stringify({ views, activeId: id }));
  } catch { /* storage bloqueado: queda la primera vista */ }
}

const FUENTE: Record<Fuente, string> = { mine: 'Ingresados por mí', assigned: 'Asignados a mí', all: 'Todos los tickets' };
const VISTA_DE_FUENTE: Record<Fuente, string> = { mine: 'ingresados', assigned: 'asignados', all: 'todos_tickets' };

function App({ o, fields, defaults, box }: { o: Opciones; fields: Fields; defaults: () => ViewConfig[]; box: HTMLElement }) {
  const load = useCallback(async (source: string) => ({ rows: await o.load(source) }), [o]);
  const sources = useMemo(() => o.fuentes.map(id => ({ id, label: FUENTE[id] })), [o]);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const h = () => setFull(document.fullscreenElement === box);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, [box]);
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : box.requestFullscreen());
  return (
    <DataViews
      fields={fields}
      idField="id"
      titleField="asunto"
      boardField="estado"
      sources={sources}
      load={load}
      storageKey={o.storageKey}
      defaultViews={defaults}
      rowHref={r => `#/t/${r.id}`}
      exportTitle="Tickets"
      forcePageSize={full ? 0 : undefined}
      validateMove={o.validateMove && ((r, f, v) => (f === 'estado' ? o.validateMove!(r, v) : 'Arrastrando solo se cambia el estado.'))}
      onMove={o.onMove && ((r, f, v) => (f === 'estado' ? o.onMove!(r, v) : Promise.reject(new Error('Arrastrando solo se cambia el estado.'))))}
      toolbarEnd={
        <span className="dv-tool">
          <button type="button" className="dv-btn" onClick={toggleFull} aria-label={full ? 'Salir de pantalla completa' : 'Pantalla completa'}>
            <i className={`fas ${full ? 'fa-compress' : 'fa-expand'}`} aria-hidden />
            <span className="dv-tool__label">{full ? 'Salir' : 'Pantalla completa'}</span>
          </button>
        </span>
      }
    />
  );
}

function montar(el: HTMLElement, o: Opciones): () => void {
  const fields = campos(o);
  const defaults = () => vistasPorDefecto(o);
  // La primera vez se abre la vista del rol (la última fuente); después, la última que usó la persona, salvo que Inicio pida otra
  try { if (!localStorage.getItem(o.storageKey)) preferir(o.storageKey, VISTA_DE_FUENTE[o.fuentes[o.fuentes.length - 1]], defaults); } catch { /* sin storage */ }
  preferir(o.storageKey, o.vistaInicial, defaults);
  const root = createRoot(el);
  root.render(<StrictMode><App o={o} fields={fields} defaults={defaults} box={el} /></StrictMode>);
  return () => root.unmount();
}

declare global { interface Window { TicketTabla?: { montar: typeof montar } } }
window.TicketTabla = { montar };
window.dispatchEvent(new Event('tickettabla:lista'));
