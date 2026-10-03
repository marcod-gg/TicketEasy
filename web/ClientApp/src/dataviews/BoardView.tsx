import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import type { Row as TRow } from '@tanstack/react-table';
import { RecordCard } from './RecordCard';
import { reduceMotion } from './StyleMenu';
import { fitColumns, openColumn, openColumns } from './rules';
import { groupDragSource, groupDropTarget, mergeDrag, type Reorder } from './groupDrag';
import type { Row, ViewProps } from './types';

const OTHERS = '\u0000otros'; // clave de la columna para valores fuera de las opciones

export function BoardView({ table, rows, fields, titleField, rowHref, boardField, onMove, validateMove, renderCard, cardActions, maxColumns = 3, open: savedOpen, onOpenChange, reorder }: ViewProps & {
  boardField: string;
  /** Tope de columnas abiertas (3 por defecto); el resto va colapsado a la barra lateral aunque quepa. */
  maxColumns?: number;
  /** Columnas abiertas guardadas en la vista (la más reciente primero); sin guardar, las primeras. */
  open?: string[];
  onOpenChange?: (open: string[]) => void;
  /** Arrastrar el encabezado de una columna sobre otra cambia su orden (orden personalizado). */
  reorder?: Reorder;
  /** Tarjeta propia de la entidad (se mueve arrastrándola). visible = ids de las propiedades visibles (Propiedades). */
  renderCard?: (row: Row, visible: Set<string>) => ReactNode;
  cardActions?: (row: Row) => ReactNode;
  onMove?: (row: Row, value: string) => void;
  validateMove?: (row: Row, field: string, value: string) => string | null;
}) {
  // Fila arrastrada: el ref la da a los handlers al instante; el estado solo pinta .is-dragging en el siguiente tick
  // (Chrome cancela el arrastre si el DOM de la tarjeta cambia durante el propio dragstart).
  const dragRef = useRef<TRow<Row> | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const endDrag = () => { dragRef.current = null; setDraggingId(null); setOver(null); };
  const [over, setOver] = useState<string | null>(null);
  const field = fields[boardField];
  const options = field.options ?? [];
  const ids = table.getVisibleLeafColumns().map(c => c.id).filter(id => id !== titleField && id !== boardField);
  const visible = new Set(table.getVisibleLeafColumns().map(c => c.id));

  // Ancho útil del tablero (no de la ventana): decide cuántas columnas caben.
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Medición inicial síncrona (el primer cuadro ya sale distribuido); luego ResizeObserver sigue los cambios.
    const cs = getComputedStyle(el);
    setWidth(Math.floor(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
    const ro = new ResizeObserver(([e]) => { const w = Math.floor(e.contentRect.width); setWidth(prev => (prev === w ? prev : w)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buckets = new Map<string, TRow<Row>[]>(options.map(o => [o.value, []]));
  const others: TRow<Row>[] = [];
  for (const r of rows) (buckets.get(String(r.getValue(boardField) ?? '')) ?? others).push(r);

  const current = (r: TRow<Row>) => String(r.getValue(boardField) ?? '');
  const canDrop = (r: TRow<Row>, to: string) =>
    !!onMove && to !== OTHERS && to !== current(r) && !validateMove?.(r.original, boardField, to);

  const columns = [...options.map(o => ({ key: o.value, color: o.color, icon: o.icon, items: buckets.get(o.value)! })),
    ...(others.length ? [{ key: OTHERS, color: undefined, icon: undefined, items: others }] : [])];
  // Icono de la opción (o punto de color si no tiene).
  const mark = (icon?: string) => (icon
    ? <span className="dv-col__icon" aria-hidden><i className={`fas ${icon}`} /></span>
    : <span className="dv-col__dot" aria-hidden />);
  const label = (key: string) => (key === OTHERS ? 'Otros' : key);

  // Abiertas: las guardadas (o las primeras) hasta lo que cabe y el tope; el resto va colapsado a la barra.
  const fit = fitColumns(width, columns.length, { max: maxColumns });
  const keys = columns.map(c => c.key);
  const open = openColumns(keys, savedOpen, fit.expanded);
  const expanded = columns.filter(c => open.includes(c.key));
  const collapsed = columns.filter(c => !open.includes(c.key));
  // Con columnas colapsadas a mano puede sobrar espacio: igual hace falta la barra.
  const barKind = !collapsed.length ? 'none' : fit.bar !== 'none' ? fit.bar : width > 0 && width < 560 ? 'top' : 'side';
  // Abrir o colapsar con transición animada (View Transitions API): la columna crece desde su botón de la barra o se
  // encoge hacia él, y el resto se desliza. Sin soporte o con "reducir movimiento": cambio directo.
  const change = (next: string[]) => {
    const apply = () => onOpenChange?.(next);
    if (!document.startViewTransition || reduceMotion(ref.current)) return apply();
    document.startViewTransition(() => flushSync(apply));
  };
  const expand = (key: string) => change(openColumn(open, key, fit.expanded));
  const collapse = (key: string) => change(open.filter(k => k !== key));
  // Mismo nombre de transición para la columna y su botón en la barra (nunca existen a la vez): así el navegador anima uno en el otro.
  const vtName = (key: string) => `dv-col-${keys.indexOf(key)}`;

  // Mismos handlers de drop para columnas y para los elementos de la barra.
  const dropTarget = (key: string) => ({
    onDragOver: (e: DragEvent) => {
      const drag = dragRef.current;
      // Se acepta el drop aunque no esté permitido para que DataViews explique el motivo; solo se resaltan los válidos.
      if (!drag || !onMove || key === OTHERS || key === current(drag)) return;
      e.preventDefault();
      const next = canDrop(drag, key) ? key : null;
      setOver(prev => (prev === next ? prev : next));
    },
    // Chrome dispara dragleave al pasar por los hijos (a veces sin relatedTarget): solo se limpia si se salió a otro elemento.
    onDragLeave: (e: DragEvent) => {
      if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOver(prev => (prev === key ? null : prev));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const drag = dragRef.current;
      endDrag();
      if (drag) onMove?.(drag.original, key);
    },
  });
  const accent = (color: string | undefined, key: string) => ({ viewTransitionName: vtName(key), ...(color ? { ['--tag' as string]: color } : {}) });

  const bar = collapsed.length > 0 && (
    <nav className={`dv-colbar dv-colbar--${barKind}`} aria-label="Columnas colapsadas">
      {collapsed.map(col => (
        <button key={col.key} type="button" className={`dv-colbar__item${over === col.key ? ' is-over' : ''}`} style={accent(col.color, col.key)}
          title={`Mostrar ${label(col.key)}`} aria-label={`Mostrar ${label(col.key)} (${col.items.length})`} onClick={() => expand(col.key)}
          {...mergeDrag(dropTarget(col.key), groupDragSource(reorder, col.key), groupDropTarget(reorder, col.key))}>
          {mark(col.icon)}
          <span className="dv-col__name">{label(col.key)}</span>
          <span className="dv-col__count">{col.items.length}</span>
        </button>
      ))}
    </nav>
  );

  return (
    <div ref={ref} className={`dv-board dv-board--bar-${barKind}`}>
      {barKind === 'top' && bar}
      {expanded.map(col => (
        <section key={col.key} className={`dv-col${over === col.key ? ' is-over' : ''}`} style={accent(col.color, col.key)} aria-label={label(col.key)} {...mergeDrag(dropTarget(col.key), groupDropTarget(reorder, col.key))}>
          <header className="dv-col__head" {...groupDragSource(reorder, col.key)}>
            {mark(col.icon)}
            <span className="dv-col__name">{label(col.key)}</span>
            <span className="dv-col__count">{col.items.length}</span>
            {onOpenChange && (
              <button type="button" className="dv-col__collapse" title={`Colapsar ${label(col.key)}`} aria-label={`Colapsar ${label(col.key)}`} onClick={() => collapse(col.key)}>
                <i className={`fas ${barKind === 'top' ? 'fa-angles-up' : 'fa-angles-right'}`} aria-hidden />
              </button>
            )}
          </header>
          <div className="dv-col__body">
            {col.items.length === 0 && <p className="dv-col__empty">Sin registros</p>}
            {col.items.map(r => {
              return (
                <div
                  key={r.id}
                  className={`dv-cardwrap${draggingId === r.id ? ' is-dragging' : ''}`}
                  draggable={!!onMove}
                  onDragStart={e => {
                    e.dataTransfer.setData('text/plain', r.id);
                    e.dataTransfer.effectAllowed = 'move';
                    dragRef.current = r;
                    setTimeout(() => setDraggingId(r.id));
                  }}
                  onDragEnd={endDrag}
                >
                  {renderCard ? renderCard(r.original, visible) : (
                    <RecordCard row={r.original} fields={fields} titleField={titleField} ids={ids} href={rowHref?.(r.original)} actions={cardActions?.(r.original)} />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {barKind === 'side' && bar}
    </div>
  );
}
