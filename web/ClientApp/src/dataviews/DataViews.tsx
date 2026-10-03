import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import {
  getCoreRowModel,
  getFilteredRowModel,
  getGroupedRowModel,
  getSortedRowModel,
  useReactTable,
  type Updater,
} from '@tanstack/react-table';
import { ExplorerView } from './ExplorerView';
import { BoardView } from './BoardView';
import { FilterEditor } from './FilterEditor';
import { Popover, closePopover } from './Popover';
import { downloadExcel, printPdf, type ExportData } from './exportData';
import { SortEditor } from './SortEditor';
import { GroupOrderEditor } from './GroupOrderEditor';
import { STYLE_DEFAULTS, StyleMenu, hasScopedThemes, reduceMotion, styleAttrs, useSiteTheme, type StylePrefs } from './StyleMenu';
import { TableView } from './TableView';
import { ViewTabs } from './ViewTabs';
import { GroupRail } from './GroupRail';
import { groupDragSource, groupDropTarget, mergeDrag, type Reorder } from './groupDrag';
import { buildColumns, formatValue } from './fields';
import { PAGE_SIZES, compareValues, describeFilter, findOperator, isActive, isGroup, matchFilters, matchSearch, paginate, railGroups, railKey, ruleValueLabel, withGroupOrder } from './rules';
import { TYPE_ICON, TYPE_LABEL, useViews } from './useViews';
import type { Fields, Row, ViewConfig, ViewType } from './types';
import './dataviews.css';

export interface DataViewsProps {
  /** Debe ser una constante de módulo (referencia estable). */
  fields: Fields;
  idField: string;
  titleField: string;
  sumField?: string;
  /** Propiedad select por defecto para las columnas del tablero. */
  boardField: string;
  /** Alcances de datos permitidos; cada vista guarda uno. El primero es el de respaldo. */
  sources: DataSource[];
  /** Carga los registros de un alcance (el servidor valida el acceso). */
  load: (source: string) => Promise<{ rows: Row[]; note?: string }>;
  storageKey: string;
  defaultViews: () => ViewConfig[];
  rowHref?: (row: Row) => string;
  /** Obsoleto: usar vistas type 'cards'. 'explorer' hace que las vistas 'board' también se muestren como tarjetas agrupadas. */
  boardLayout?: 'columns' | 'explorer';
  /** Tablero agrupado con tarjetas: botones propios de cada grupo (p. ej. Editar/Eliminar sección) y mostrar grupos sin registros. */
  groupActions?: (value: string, rows: Row[]) => ReactNode;
  showEmptyGroups?: boolean;
  onRenameGroup?: (value: string, name: string) => Promise<void>;
  /** Tablero: tope de columnas abiertas (3 por defecto); las demás van colapsadas a la barra lateral. */
  boardMaxColumns?: number;
  /** Acciones por fila en la tabla (p. ej. Editar/Eliminar); se muestran en una celda final fija. */
  rowActions?: (row: Row) => ReactNode;
  /** Ancho de la celda de acciones: 96 px solo íconos (defecto), 130 px con "Editar" de texto. */
  rowActionsWidth?: number;
  /** Persiste el cambio de grupo (al soltar); si rechaza, vuelve a su lugar con el motivo como aviso. Rechazar con null = cancelado (sin aviso), p. ej. al cerrar una confirmación. */
  onMove?: (row: Row, field: string, value: string) => Promise<void>;
  /** null = permitido; string = motivo del rechazo. */
  validateMove?: (row: Row, field: string, value: string) => string | null;
  /** Tarjeta propia para el tablero (source = alcance de la vista; visible = propiedades visibles, debe respetarlas). */
  renderCard?: (row: Row, ctx: { source: string; visible: Set<string> }) => ReactNode;
  /** Acciones al pie de la tarjeta por defecto (p. ej. Editar / Eliminar), sin tener que escribir renderCard. */
  cardActions?: (row: Row) => ReactNode;
  /** Filas por página forzadas sin tocar la vista guardada (p. ej. 0 = todas en pantalla completa). */
  forcePageSize?: number;
  /** Con título, la barra muestra "Descargar" (Excel / PDF) con lo que cumple los filtros de la vista. */
  exportTitle?: string;
  /** Botones propios al final de la barra (p. ej. Imprimir / Pantalla completa), tras un separador. */
  toolbarEnd?: ReactNode;
  /** Oculta el botón Actualizar del pie (p. ej. si la página ya tiene su propio indicador de actualización). */
  hideRefresh?: boolean;
  /** Diseños disponibles (tope): cada vista elige cuáles mostrar en "Configuración"; por defecto todos. */
  viewTypes?: ViewType[];
  /** Herramientas de la barra; todas encendidas salvo las que se pasen en false. */
  tools?: Partial<Record<ToolId, boolean>>;
}

export type ToolId = 'search' | 'filter' | 'sort' | 'group' | 'props' | 'export' | 'summary' | 'style' | 'config';

// Herramientas que cada vista enciende o apaga en "Configuración" (config siempre queda visible).
const VIEW_TOOLS: { id: ToolId; label: string; icon: string }[] = [
  { id: 'search', label: 'Buscar', icon: 'fa-magnifying-glass' },
  { id: 'filter', label: 'Filtrar', icon: 'fa-filter' },
  { id: 'sort', label: 'Ordenar', icon: 'fa-arrow-down-wide-short' },
  { id: 'group', label: 'Agrupar', icon: 'fa-layer-group' },
  { id: 'props', label: 'Propiedades', icon: 'fa-eye' },
  { id: 'export', label: 'Descargar', icon: 'fa-download' },
  { id: 'summary', label: 'Resumen de la vista', icon: 'fa-list-check' },
];

export interface DataSource {
  id: string;
  label: string;
}

interface Loaded {
  rows: Row[];
  note?: string;
  error?: string;
  loading: boolean;
}

const NO_ROWS: Row[] = [];
const RAIL_ALL = '\u0000todos'; // "Todos" de los segmentos (no choca con un valor real)

/** Contenido del botón de herramienta: icono + nombre (se despliega con hover/foco) + contador si hay algo activo. */
const tool = (icon: string, label: string, count = 0) => (
  <>
    <i className={`fas ${icon}`} aria-hidden />
    <span className="dv-tool__label">{label}</span>
    {count > 0 && <span className="dv-tool__badge" aria-label={`${count} activos`}>{count}</span>}
  </>
);

const apply =<T,>(u: Updater<T>, old: T): T => (typeof u === 'function' ? (u as (o: T) => T)(old) : u);

export function DataViews(p: DataViewsProps) {
  const { titleField, sumField } = p;
  const { views, active: saved, setActive, update, add, duplicate, remove } = useViews(p.storageKey, p.defaultViews);
  const offered = p.viewTypes?.length ? p.viewTypes : (Object.keys(TYPE_LABEL) as ViewType[]);
  // Diseños de esta vista (Configuración); sin elegir o fuera del tope = todos los ofrecidos.
  const picked = offered.filter(t => saved.types?.includes(t));
  const viewTypes = picked.length ? picked : offered;
  const view = viewTypes.includes(saved.type) ? saved : { ...saved, type: viewTypes[0] };
  // Orden personalizado de grupos de la vista: se aplica al esquema y lo respetan segmentos, secciones, columnas y subtítulos.
  const fields = useMemo(() => withGroupOrder(p.fields, view.groupOrder), [p.fields, view.groupOrder]);
  // Tope del montaje (tools, exportTitle) y, dentro de él, lo que la vista dejó encendido.
  const allowed = (t: ToolId) => p.tools?.[t] !== false && (t !== 'export' || !!p.exportTitle);
  const has = (t: ToolId) => allowed(t) && (t === 'config' || view.tools?.[t] !== false);
  const viewTools = VIEW_TOOLS.filter(t => allowed(t.id));
  const set = (patch: Partial<ViewConfig>) => update(view.id, patch);

  // Envuelve un cambio de la tabla (filtros, orden, agrupado, columnas, paginado) en una View Transition:
  // el navegador anima suavemente del estado viejo al nuevo. Si no la soporta, aplica el cambio al instante.
  const tx = (fn: () => void) => {
    const start = (document as Document & { startViewTransition?: (cb: () => void) => unknown }).startViewTransition;
    if (start && style.motion !== 'reduce' && !reduceMotion()) start.call(document, () => flushSync(fn));
    else fn();
  };

  // Estilo de la vista (menú «…»): se guarda con la vista, como sus filtros y columnas
  const style: StylePrefs = { ...STYLE_DEFAULTS, ...view.style };
  const changeStyle = (next: StylePrefs) => set({ style: next });
  const [themed] = useState(hasScopedThemes);
  const siteTheme = useSiteTheme();

  // Una vista con un alcance no permitido (storage viejo o manipulado) cae al primero permitido.
  const source = p.sources.some(s => s.id === view.source) ? view.source : p.sources[0].id;

  // Caché por alcance: cambiar de vista no vuelve a pedir datos ya cargados.
  const [cache, setCache] = useState<Record<string, Loaded>>({});
  const { load } = p;
  useEffect(() => {
    if (cache[source]) return;
    setCache(c => ({ ...c, [source]: { rows: NO_ROWS, loading: true } }));
    load(source)
      .then(r => setCache(c => ({ ...c, [source]: { rows: r.rows, note: r.note, loading: false } })))
      .catch(e => setCache(c => ({ ...c, [source]: { rows: NO_ROWS, loading: false, error: e?.message || 'No se pudieron cargar los registros.' } })));
  }, [cache, source, load]);
  const refresh = () => setCache(c => {
    const { [source]: _, ...rest } = c;
    return rest;
  });
  // Recarga desde fuera (p. ej. tras crear/editar en un modal de la página): window.dispatchEvent(new Event('dataviews:refresh')).
  useEffect(() => {
    const h = () => setCache({});
    window.addEventListener('dataviews:refresh', h);
    return () => window.removeEventListener('dataviews:refresh', h);
  }, []);
  // Recarga en segundo plano sin vaciar la vista (auto-refresh de pantallas): window.dispatchEvent(new Event('dataviews:reload')).
  useEffect(() => {
    const h = () => load(source)
      .then(r => setCache(c => ({ ...c, [source]: { rows: r.rows, note: r.note, loading: false } })))
      .catch(() => { /* se conservan las filas anteriores */ });
    window.addEventListener('dataviews:reload', h);
    return () => window.removeEventListener('dataviews:reload', h);
  }, [source, load]);
  const loaded = cache[source];
  const allRows = loaded?.rows ?? NO_ROWS;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const columns = useMemo(() => buildColumns(fields, titleField, sumField), [fields, titleField, sumField]);
  // Filtros y búsqueda antes de TanStack: sus columnFilters solo combinan con 'y' (aquí hay reglas con 'o'),
  // y los segmentos cuentan lo que cumple ambos.
  const filtered = useMemo(
    () => allRows.filter(r => matchFilters(view.filters, fields, r) && matchSearch(view.search, fields, r)),
    [allRows, view.filters, view.search, fields],
  );
  const boardField = fields[view.groupBy]?.type === 'select' ? view.groupBy : p.boardField;
  // Tablero y tarjetas: grupos por un select, sin paginar; solo la tabla agrupa con TanStack.
  const byGroup = view.type !== 'table';

  // Segmentos: un solo ajuste por vista para los tres diseños ("Todos" o un grupo); el elegido se mantiene al cambiar de diseño.
  const railBy = view.railBy && fields[view.railBy] ? view.railBy : '';
  const railEmpty = view.type === 'cards' && !!p.showEmptyGroups;
  const railItems = useMemo(() => (railBy ? railGroups(fields[railBy], railBy, filtered, railEmpty) : []), [railBy, fields, filtered, railEmpty]);
  const [railPicked, setRailPicked] = useState(RAIL_ALL);
  const dragRow = useRef<Row | null>(null); // tarjeta que se arrastra (Tarjetas → segmento)
  const [railOver, setRailOver] = useState<string | null>(null);
  useEffect(() => setRailPicked(RAIL_ALL), [view.id, railBy]);
  // El elegido desaparece con un filtro → "Todos".
  const railPick = railItems.some(g => g.key === railPicked) ? railPicked : RAIL_ALL;
  const railLabel = (key: string) => (key === RAIL_ALL ? 'Todos' : formatValue(fields[railBy], key) || 'Sin valor');
  const data = useMemo(
    () => (railBy && railPick !== RAIL_ALL ? filtered.filter(r => railKey(fields[railBy], r[railBy]) === railPick) : filtered),
    [filtered, railBy, railPick, fields],
  );
  const grouping = useMemo(
    () => (!byGroup && fields[view.groupBy] ? [view.groupBy] : []),
    [byGroup, view.groupBy, fields],
  );
  const state = useMemo(
    // La columna obligatoria (titleField) siempre visible, aunque una vista guardada antigua la tuviera oculta.
    () => ({ grouping, sorting: view.sorting, columnOrder: view.order ?? [], columnSizing: view.sizes ?? {}, columnVisibility: { ...view.hidden, [titleField]: true } }),
    [grouping, view.sorting, view.order, view.sizes, view.hidden, titleField],
  );

  const table = useReactTable<Row>({
    data,
    columns,
    state,
    getRowId: r => String(r[p.idField]),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getSortedRowModel: getSortedRowModel(),
    groupedColumnMode: false,
    autoResetExpanded: false,
    autoResetPageIndex: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onSortingChange: u => tx(() => set({ sorting: apply(u, view.sorting) })),
    onColumnOrderChange: u => set({ order: apply(u, view.order ?? []) }),
    onColumnSizingChange: u => set({ sizes: apply(u, view.sizes ?? {}) }),
    onColumnVisibilityChange: u => {
      const { [titleField]: _, ...hidden } = apply(u, view.hidden) as Record<string, boolean>;
      tx(() => set({ hidden }));
    },
  });

  const modelRows = table.getRowModel().rows;
  const groups = grouping.length
    ? [...modelRows].sort((a, b) => compareValues(fields[grouping[0]], a.groupingValue, b.groupingValue))
    : modelRows;
  const shown = table.getFilteredRowModel().rows.length;

  // Paginación de tabla/lista sobre la lista aplanada (encabezados + filas visibles). El tablero muestra todo.
  // No usa getPaginationRowModel: el orden de grupos por opción y el colapsado viven fuera de TanStack.
  const pageSize = p.forcePageSize ?? view.pageSize ?? PAGE_SIZES[0];
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => setPageIndex(0), [view.id, source, view.filters, view.search, view.groupBy, view.sorting, pageSize, railPick]);
  const flat = grouping.length ? groups.flatMap(g => [g, ...(collapsed[g.id] ? [] : g.subRows)]) : groups;
  const page = paginate(flat, pageIndex, byGroup ? 0 : pageSize, r => r.getIsGrouped());
  const rows = byGroup ? groups : page.rows;

  const move = async (row: Row, field: string, value: string) => {
    const reason = p.validateMove?.(row, field, value);
    if (reason) return setNotice(reason);
    const id = String(row[p.idField]);
    const patch = (v: unknown) => setCache(c => ({
      ...c,
      [source]: { ...c[source], rows: c[source].rows.map(r => (String(r[p.idField]) === id ? { ...r, [field]: v } : r)) },
    }));
    patch(value); // optimista
    try {
      await p.onMove!(row, field, value);
      // El registro puede aparecer en otros alcances: se recargan al volver a ellos.
      setCache(c => ({ [source]: c[source] }));
    } catch (e) {
      patch(row[field]);
      if (e !== null) setNotice(e instanceof Error && e.message ? e.message : 'No se pudo guardar el cambio.'); // null = cancelado: sin aviso
    }
  };

  const activeRules = view.filters.filter(f => isActive(f, fields));
  const clearAll = () => tx(() => set({ filters: [], search: '' }));

  // Descarga: todas las filas que cumplen filtros y búsqueda (sin paginar ni contraer grupos), en el orden
  // de la vista y con las columnas visibles. Los encabezados de grupo solo aparecen en el PDF.
  const exportData = (): ExportData => {
    const stamp = new Date();
    const day = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`;
    const sourceLabel = p.sources.find(s => s.id === source)?.label;
    return {
      title: `${p.exportTitle} · ${view.name}`,
      fileName: `${p.exportTitle} - ${view.name} - ${day}`.replace(/[\\/:*?"<>|]/g, '-'),
      columns: table.getVisibleLeafColumns().map(c => ({ id: c.id, field: fields[c.id] })),
      rows: groups.flatMap(g => g.getIsGrouped()
        ? [{ group: String(g.groupingValue ?? ''), count: g.subRows.length }, ...g.subRows.map(r => ({ values: r.original }))]
        : [{ values: g.original }]),
      filters: [
        ...(p.sources.length > 1 && sourceLabel ? [`Datos: ${sourceLabel}`] : []),
        ...activeRules.map((f, i) => `${i > 0 ? (f.join === 'or' ? 'o ' : 'y ') : ''}${describeFilter(f, fields)}`),
        ...(view.search ? [`Búsqueda «${view.search}»`] : []),
        ...(railBy && railPick !== RAIL_ALL ? [`${fields[railBy].label}: ${railLabel(railPick)}`] : []),
      ],
    };
  };
  const goPage = (i: number) => tx(() => setPageIndex(i));
  const selectFields = Object.keys(fields).filter(id => fields[id].type === 'select');
  // Reordenar arrastrando los grupos de un select (segmentos, secciones, columnas, subtítulos): guarda el orden personalizado.
  const reorderFor = (id: string): Reorder | undefined => (fields[id]?.type === 'select' ? {
    field: id, keys: fields[id].options!.map(o => o.value),
    onReorder: keys => tx(() => set({ groupOrder: { ...view.groupOrder, [id]: keys } })),
  } : undefined);

  const viewProps = {
    table, rows, fields, titleField, sumField, collapsed, rowHref: p.rowHref, rowActions: p.rowActions, rowActionsWidth: p.rowActionsWidth,
    onToggle: (id: string) => setCollapsed(c => ({ ...c, [id]: !c[id] })),
  };

  let body;
  if (!loaded || loaded.loading) body = <div className="dv-empty"><i className="fas fa-circle-notch fa-spin" aria-hidden /> Cargando registros…</div>;
  else if (loaded.error)
    body = (
      <div className="dv-empty" role="alert">
        {loaded.error}
        <button type="button" className="dv-link" onClick={refresh}>Reintentar</button>
      </div>
    );
  else if (!allRows.length) body = <div className="dv-empty">Aún no hay registros para mostrar.</div>;
  else if (!shown)
    body = (
      <div className="dv-empty">
        Ningún registro cumple los filtros. Quita alguno o limpia la búsqueda.
        <button type="button" className="dv-link" onClick={clearAll}>Limpiar filtros y búsqueda</button>
      </div>
    );
  // Tabla agrupada por el campo del tablero: mismas acciones de grupo que el tablero agrupado con tarjetas (renombrar, controles, mover).
  else if (!byGroup) body = view.groupBy && view.groupBy === p.boardField
    ? <TableView {...viewProps} groupReorder={reorderFor(view.groupBy)} groupActions={p.groupActions} onRenameGroup={p.onRenameGroup}
        onMoveToGroup={p.onMove && ((r, v) => move(r, p.boardField, v))} />
    : <TableView {...viewProps} groupReorder={reorderFor(view.groupBy)} />; // incluye vistas antiguas de tipo lista
  // key por vista: las columnas abiertas desde la barra no se arrastran de una vista a otra.
  else if (view.type === 'cards' || p.boardLayout === 'explorer') body = <ExplorerView key={view.id} {...viewProps} boardField={boardField} reorder={reorderFor(boardField)}
    onMove={p.onMove && ((r, v) => move(r, boardField, v))} groupActions={p.groupActions} showEmptyGroups={p.showEmptyGroups && railPick === RAIL_ALL} onRenameGroup={p.onRenameGroup}
    title={railBy ? railLabel(railPick) : 'Todos'} onDragRow={r => { dragRow.current = r; if (!r) setRailOver(null); }} cardActions={p.cardActions} renderCard={p.renderCard && ((row, visible) => p.renderCard!(row, { source, visible }))} />;
  else body = <BoardView key={view.id} {...viewProps} boardField={boardField} reorder={reorderFor(boardField)} onMove={p.onMove && ((r, v) => move(r, boardField, v))} validateMove={p.validateMove}
    cardActions={p.cardActions} renderCard={p.renderCard && ((row, visible) => p.renderCard!(row, { source, visible }))} maxColumns={p.boardMaxColumns}
    open={view.boardOpen?.[boardField]} onOpenChange={o => set({ boardOpen: { ...view.boardOpen, [boardField]: o } })} />;
  // Segmentos: lista a la izquierda (barra arriba en pantallas chicas). En Tarjetas con onMove, soltar una tarjeta en un segmento la mueve.
  const railDrop = (key: string) => (view.type !== 'cards' || !p.onMove || fields[railBy]?.type !== 'select' || key === RAIL_ALL ? {} : {
    onDragOver: (e: DragEvent) => {
      const r = dragRow.current;
      if (!r || String(r[railBy] ?? '') === key) return;
      e.preventDefault();
      setRailOver(key);
    },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setRailOver(o => (o === key ? null : o)); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const r = dragRow.current;
      dragRow.current = null; setRailOver(null);
      if (r) move(r, railBy, key);
    },
  });
  if (railBy && loaded && !loaded.loading && !loaded.error && filtered.length)
    body = (
      <div className="dv-explorer dv-explorer--rail">
        <GroupRail label={fields[railBy].label} current={railPick} onPick={k => tx(() => setRailPicked(k))} over={railOver}
          itemProps={key => (key === RAIL_ALL ? {} : mergeDrag(railDrop(key), groupDragSource(reorderFor(railBy), key), groupDropTarget(reorderFor(railBy), key)))}
          items={[{ key: RAIL_ALL, icon: 'fa-layer-group', count: filtered.length }, ...railItems].map(g => ({ ...g, label: railLabel(g.key) }))} />
        <section className="dv-explorer__detail" aria-label={`${fields[railBy].label}: ${railLabel(railPick)}`}>{body}</section>
      </div>
    );

  // Resumen de la vista: filtros, búsqueda, segmentos, agrupado, orden y propiedades ocultas.
  type Chip = { key: string; label: ReactNode; aria: string; remove?: () => void };
  const hiddenCols = Object.entries(view.hidden).filter(([k, v]) => v === false && k !== titleField).map(([k]) => k);
  const groupField = view.type === 'table' ? (fields[view.groupBy] ? view.groupBy : '') : boardField;
  const groupCat = view.type === 'board' ? 'Columnas' : view.type === 'cards' ? 'Subtítulos' : 'Secciones';
  const summary: { cat: string; short: string; chips: Chip[] }[] = [];
  if (activeRules.length) summary.push({
    cat: 'Filtros', short: `${activeRules.length} ${activeRules.length === 1 ? 'filtro' : 'filtros'}`,
    chips: activeRules.map(f => {
      const or = f.join === 'or' && view.filters.indexOf(f) > 0 && <i>o </i>;
      const remove = () => tx(() => set({ filters: view.filters.filter(x => x.id !== f.id) }));
      if (isGroup(f)) return { key: f.id, label: <>{or}<b>Grupo</b> {describeFilter(f, fields)}</>, aria: 'grupo de filtros', remove };
      const op = findOperator(fields[f.col].type, f.op)!;
      return { key: f.id, label: <>{or}<b>{fields[f.col].label}</b> {op.label} {op.needsValue && <q>{ruleValueLabel(f)}</q>}</>, aria: `filtro ${fields[f.col].label}`, remove };
    }),
  });
  if (view.search) summary.push({
    cat: 'Búsqueda', short: `búsqueda «${view.search}»`,
    chips: [{ key: 'search', label: <q>{view.search}</q>, aria: 'búsqueda', remove: () => tx(() => set({ search: '' })) }],
  });
  if (railBy) summary.push({
    cat: 'Segmentos', short: `segmentos por ${fields[railBy].label}`,
    chips: [
      { key: 'rail', label: <>según <b>{fields[railBy].label}</b></>, aria: 'segmentos', remove: () => tx(() => set({ railBy: '' })) },
      ...(railPick !== RAIL_ALL ? [{ key: 'pick', label: <>elegido <b>{railLabel(railPick)}</b></>, aria: 'segmento elegido', remove: () => tx(() => setRailPicked(RAIL_ALL)) }] : []),
    ],
  });
  if (groupField) summary.push({
    cat: groupCat, short: `${groupCat.toLowerCase()} por ${fields[groupField].label}`,
    // Tablero y tarjetas siempre agrupan por un select: se cambia en Agrupar, no se quita.
    chips: [{ key: 'group', label: <>según <b>{fields[groupField].label}</b></>, aria: groupCat.toLowerCase(), remove: view.type === 'table' ? () => tx(() => set({ groupBy: '' })) : undefined }],
  });
  // Grupos en uso que se pueden ordenar a mano (solo selects); "Todos" no entra.
  const isSelect = (id: string) => fields[id]?.type === 'select';
  const orderable = [
    ...(railBy && isSelect(railBy) ? [{ id: railBy, role: groupField === railBy ? `Segmentos y ${groupCat.toLowerCase()}` : 'Segmentos' }] : []),
    ...(groupField && isSelect(groupField) && groupField !== railBy ? [{ id: groupField, role: groupCat }] : []),
  ];
  const customOrder = Object.keys(view.groupOrder ?? {}).filter(id => fields[id]);
  if (view.sorting.length || customOrder.length) summary.push({
    cat: 'Orden', short: [view.sorting.length && `orden por ${view.sorting.map(o => fields[o.id]?.label).join(', ')}`,
      customOrder.length && `orden personalizado de ${customOrder.map(id => fields[id].label).join(', ')}`].filter(Boolean).join(' · '),
    chips: [
      ...view.sorting.filter(o => fields[o.id]).map((o, i) => ({
        key: o.id, label: <>{i > 0 && <i>luego </i>}<b>{fields[o.id].label}</b> {o.desc ? '↓ descendente' : '↑ ascendente'}</>,
        aria: `orden ${fields[o.id].label}`, remove: () => tx(() => set({ sorting: view.sorting.filter(x => x.id !== o.id) })),
      })),
      ...customOrder.map(id => ({
        key: `order-${id}`, label: <><b>{fields[id].label}</b> personalizado</>, aria: `orden personalizado de ${fields[id].label}`,
        remove: () => tx(() => { const { [id]: _, ...rest } = view.groupOrder!; set({ groupOrder: rest }); }),
      })),
    ],
  });
  if (hiddenCols.length) summary.push({
    cat: 'Ocultas', short: `${hiddenCols.length} ${hiddenCols.length === 1 ? 'propiedad oculta' : 'propiedades ocultas'}`,
    chips: hiddenCols.filter(k => fields[k]).map(k => ({ key: k, label: fields[k].label, aria: `${fields[k].label} de las ocultas`, remove: () => tx(() => set({ hidden: { ...view.hidden, [k]: true } })) })),
  });
  // Quitar todo: deja la vista sin filtros, búsqueda, segmentos, secciones, orden ni columnas ocultas (no toca diseño ni anchos).
  const resetView = () => { setRailPicked(RAIL_ALL); tx(() => set({ filters: [], search: '', railBy: '', sorting: [], groupOrder: {}, hidden: {}, ...(view.type === 'table' ? { groupBy: '' } : {}) })); };

  // Configuración (menú «…» de las pestañas): diseños y herramientas de la vista activa.
  const configPanel = has('config') ? (
            <div className="dv-editor dv-config">
              {offered.length > 1 && <>
              <b>Diseños de esta vista</b>
              {offered.map(t => (
                <label key={t} className="dv-check">
                  <input type="checkbox" checked={viewTypes.includes(t)} disabled={viewTypes.length === 1 && viewTypes.includes(t)}
                    onChange={e => {
                      const types = e.target.checked ? offered.filter(x => x === t || viewTypes.includes(x)) : viewTypes.filter(x => x !== t);
                      tx(() => set({ types, ...(types.includes(view.type) ? {} : { type: types[0] }) }));
                    }} />
                  <i className={`fas ${TYPE_ICON[t]}`} aria-hidden /> {TYPE_LABEL[t]}
                </label>
              ))}
              <span className="dv-muted">Al menos uno. Con uno solo se oculta el selector de diseño.</span>
              </>}
              <b>Herramientas de esta vista</b>
              {viewTools.map(t => (
                <label key={t.id} className="dv-check">
                  <input type="checkbox" checked={has(t.id)}
                    onChange={e => { const on = e.target.checked; tx(() => set({ tools: { ...view.tools, [t.id]: on } })); }} />
                  <i className={`fas ${t.icon}`} aria-hidden /> {t.label}
                </label>
              ))}
              <span className="dv-muted">Ocultar una herramienta no quita sus filtros ni su orden.</span>
            </div>
  ) : undefined;


  return (
    <div className={`dv${themed ? ' dt-thp' : ''}`} {...styleAttrs(style, siteTheme, themed)}>
      <ViewTabs
        views={views}
        activeId={view.id}
        onSelect={setActive}
        onRename={(id, name) => update(id, { name })}
        // La vista nueva hereda los datos de la pestaña activa (el alcance no se elige aparte).
        types={offered}
        onAdd={type => add(type, source, `${TYPE_LABEL[type]} · ${p.sources.find(s => s.id === source)?.label ?? ''}`)}
        onDuplicate={duplicate}
        onRemove={remove}
        config={configPanel}
        style={has('style') ? <StyleMenu prefs={style} onChange={changeStyle} themed={themed} site={siteTheme} /> : undefined}
      />

      <div className="dv-toolbar" role="toolbar" aria-label="Opciones de la vista">
        {viewTypes.length > 1 && (
          <div className="dv-seg" role="group" aria-label="Diseño">
            {viewTypes.map(t => (
              <button key={t} type="button" aria-pressed={view.type === t} className={view.type === t ? 'is-active' : ''} onClick={() => tx(() => set({ type: t }))}>
                <i className={`fas ${TYPE_ICON[t]}`} aria-hidden /> {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        )}

        {/* Herramientas: solo icono; el nombre se despliega con hover o foco. */}
        <div className="dv-tools">
          {has('search') && <label className={`dv-search${view.search ? ' has-value' : ''}`} title="Buscar">
            <i className="fas fa-magnifying-glass" aria-hidden />
            <input type="search" placeholder="Buscar…" aria-label="Buscar en todos los campos" value={view.search} onChange={e => set({ search: e.target.value })} />
          </label>}

          {has('filter') && <Popover className="dv-tool dv-pop--filters" align="right" label={tool('fa-filter', 'Filtrar', activeRules.length)}>
            <FilterEditor fields={fields} filters={view.filters} onChange={filters => tx(() => set({ filters }))} />
          </Popover>}

          {has('sort') && <Popover className="dv-tool" align="right" label={tool('fa-arrow-down-wide-short', 'Ordenar', view.sorting.length + customOrder.length)}>
            <SortEditor fields={fields} sorting={view.sorting} onChange={sorting => tx(() => set({ sorting }))} />
            <GroupOrderEditor fields={fields} groups={orderable} order={view.groupOrder ?? {}} onChange={groupOrder => tx(() => set({ groupOrder }))} />
          </Popover>}

          {has('group') && <Popover className="dv-tool" align="right"
            label={tool('fa-layer-group', 'Agrupar', (railBy ? 1 : 0) + (!byGroup && fields[view.groupBy] ? 1 : 0))}>
          <div className="dv-editor">
            {/* Segmentos: mismo ajuste para los tres diseños de la vista. */}
            <label className="dv-editor">
              Segmentar según
              <select value={railBy} onChange={e => { const railBy = e.target.value; tx(() => set({ railBy })); }}>
                <option value="">Sin segmentos</option>
                {Object.keys(fields).map(id => <option key={id} value={id}>{fields[id].label}</option>)}
              </select>
            </label>
            <label className="dv-editor">
              {view.type === 'board' ? 'Columnas del tablero según' : view.type === 'cards' ? 'Subtítulos de tarjetas según' : 'Secciones dentro de la tabla según'}
              <select value={byGroup ? boardField : view.groupBy} onChange={e => { const groupBy = e.target.value; tx(() => set({ groupBy })); }}>
                {!byGroup && <option value="">Sin secciones</option>}
                {(byGroup ? selectFields : Object.keys(fields)).map(id => <option key={id} value={id}>{fields[id].label}</option>)}
              </select>
            </label>
          </div>
        </Popover>}

          {has('props') && <Popover className="dv-tool" align="right" label={tool('fa-eye', 'Propiedades', Object.entries(view.hidden).filter(([k, v]) => v === false && k !== titleField).length)}>
          <div className="dv-editor">
            <label className="dv-check dv-check--all">
              <input
                type="checkbox"
                checked={table.getIsAllColumnsVisible()}
                ref={el => { if (el) el.indeterminate = !table.getIsAllColumnsVisible() && table.getIsSomeColumnsVisible(); }}
                onChange={table.getToggleAllColumnsVisibilityHandler()}
              />
              <b>Marcar/desmarcar todas</b>
            </label>
            {table.getAllLeafColumns().map(c => (
              <label key={c.id} className="dv-check">
                <input type="checkbox" checked={c.getIsVisible()} disabled={!c.getCanHide()} onChange={c.getToggleVisibilityHandler()} />
                {fields[c.id].label}
                {!c.getCanHide() && <span className="dv-muted"> (obligatorio)</span>}
              </label>
            ))}
          </div>
        </Popover>}

          {has('export') && (
            <Popover className="dv-tool dv-pop--menu" align="right" label={tool('fa-download', 'Descargar')}>
              <button type="button" className="dv-menuitem" disabled={!shown} onClick={e => { closePopover(e.currentTarget); downloadExcel(exportData()); }}>
                <i className="fas fa-file-excel" aria-hidden /> Excel (.xlsx)
              </button>
              <button type="button" className="dv-menuitem" disabled={!shown} onClick={e => { closePopover(e.currentTarget); printPdf(exportData()); }}>
                <i className="fas fa-file-pdf" aria-hidden /> PDF (imprimir tabla)
              </button>
              <p className="dv-menunote">{shown} {shown === 1 ? 'registro' : 'registros'} con los filtros de esta vista</p>
            </Popover>
          )}
          {p.toolbarEnd && <><span className="dv-tools__sep" aria-hidden />{p.toolbarEnd}</>}
        </div>
      </div>

      {/* Resumen de la vista: desplegable (cerrado por defecto) con todo lo aplicado; cada chip se quita con su ✕. */}
      {has('summary') && summary.length > 0 && (
        <details className="dv-fsum">
          <summary>
            <i className="fas fa-list-check" aria-hidden />
            <span>{summary.map(c => c.short).join(' · ')}</span>
            <i className="fas fa-chevron-down dv-fsum__chev" aria-hidden />
          </summary>
          <div className="dv-fsum__body">
            {summary.map(c => (
              <div key={c.cat} className="dv-fsum__row">
                <span className="dv-fsum__cat">{c.cat}</span>
                {c.chips.map(ch => (
                  <span key={ch.key} className="dv-fchip">
                    {ch.label}
                    {ch.remove && <button type="button" aria-label={`Quitar ${ch.aria}`} onClick={ch.remove}><i className="fas fa-xmark" aria-hidden /></button>}
                  </span>
                ))}
              </div>
            ))}
            <button type="button" className="dv-link" onClick={resetView}>Quitar todo</button>
          </div>
        </details>
      )}

      {notice && (
        <div className="dv-notice" role="status">
          <i className="fas fa-circle-info" aria-hidden /> {notice}
          <button type="button" className="dv-icon" aria-label="Cerrar aviso" onClick={() => setNotice(null)}><i className="fas fa-xmark" aria-hidden /></button>
        </div>
      )}

      {body}

      {/* Pie: resumen de elementos (y en tabla, filas por página + paginación) bajo el contenido. */}
      {loaded && !loaded.loading && !loaded.error && (
        <footer className="dv-foot">
          <span className="dv-count" aria-live="polite">
            {shown} de {allRows.length} registros
            {loaded.note && <span className="dv-muted"> · {loaded.note}</span>}
          </span>
          {!p.hideRefresh && (
            <button type="button" className="dv-icon" aria-label="Actualizar registros" title="Actualizar" onClick={refresh}>
              <i className="fas fa-rotate" aria-hidden />
            </button>
          )}
          {!byGroup && shown > 0 && (
            <nav className="dv-pager" aria-label="Paginación">
              <label>
                Filas por página
                <select value={pageSize} onChange={e => {
                  // Se lee antes de la transición: dentro de ella React ya devolvió el select controlado al valor anterior.
                  const n = Number(e.target.value);
                  tx(() => set({ pageSize: n }));
                }}>
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n || 'Todos'}</option>)}
                </select>
              </label>
              {page.pageCount > 1 && (
                <span className="dv-pager__nav">
                  <button type="button" className="dv-icon" aria-label="Primera página" disabled={page.index === 0} onClick={() => goPage(0)}>
                    <i className="fas fa-angles-left" aria-hidden />
                  </button>
                  <button type="button" className="dv-icon" aria-label="Página anterior" disabled={page.index === 0} onClick={() => goPage(page.index - 1)}>
                    <i className="fas fa-chevron-left" aria-hidden />
                  </button>
                  <span aria-live="polite">Página {page.index + 1} de {page.pageCount}</span>
                  <button type="button" className="dv-icon" aria-label="Página siguiente" disabled={page.index >= page.pageCount - 1} onClick={() => goPage(page.index + 1)}>
                    <i className="fas fa-chevron-right" aria-hidden />
                  </button>
                  <button type="button" className="dv-icon" aria-label="Última página" disabled={page.index >= page.pageCount - 1} onClick={() => goPage(page.pageCount - 1)}>
                    <i className="fas fa-angles-right" aria-hidden />
                  </button>
                </span>
              )}
            </nav>
          )}
        </footer>
      )}
    </div>
  );
}
