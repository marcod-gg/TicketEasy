import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { Row as TRow } from '@tanstack/react-table';
import { RecordCard } from './RecordCard';
import { groupDragSource, groupDropTarget, mergeDrag, type Reorder } from './groupDrag';
import type { Row, ViewProps } from './types';

const OTHERS = '\u0000otros';

/**
 * Tarjetas agrupadas: un subtítulo (nombre + cantidad) y una cuadrícula por grupo del select. Los segmentos van fuera
 * (GroupRail de DataViews, mismo railBy que Tabla y Tablero); aquí llegan solo las filas del segmento elegido.
 * Grupos vacíos no se listan salvo showEmptyGroups. Con onMove, las tarjetas se arrastran a un subtítulo.
 */
export function ExplorerView({ table, rows, fields, titleField, rowHref, boardField, renderCard, cardActions, onMove, groupActions, showEmptyGroups, onRenameGroup, title, onDragRow, reorder }: ViewProps & {
  boardField: string;
  /** Encabezado: el segmento elegido o "Todos". */
  title: string;
  /** Avisa qué tarjeta se arrastra (para soltarla en un segmento de la lista). */
  onDragRow?: (row: Row | null) => void;
  /** Arrastrar un subtítulo sobre otro cambia el orden de los grupos (orden personalizado). */
  reorder?: Reorder;
  renderCard?: (row: Row, visible: Set<string>) => ReactNode;
  cardActions?: (row: Row) => ReactNode;
  onMove?: (row: Row, value: string) => void;
  /** Botones propios del grupo (p. ej. Editar/Eliminar sección); van en su encabezado. */
  groupActions?: (value: string, rows: Row[]) => ReactNode;
  showEmptyGroups?: boolean;
  /** Doble clic en el nombre del grupo para renombrarlo (Enter guarda, Esc cancela). */
  onRenameGroup?: (value: string, name: string) => Promise<void>;
}) {
  const options = fields[boardField].options ?? [];
  const visible = new Set(table.getVisibleLeafColumns().map(c => c.id));
  const ids = table.getVisibleLeafColumns().map(c => c.id).filter(id => id !== titleField && id !== boardField);

  const buckets = new Map<string, TRow<Row>[]>(options.map(o => [o.value, []]));
  const others: TRow<Row>[] = [];
  for (const r of rows) (buckets.get(String(r.getValue(boardField) ?? '')) ?? others).push(r);
  const groups = [...options.map(o => ({ key: o.value, icon: o.icon, items: buckets.get(o.value)! })),
    { key: OTHERS, icon: undefined, items: others }].filter(g => g.items.length || (showEmptyGroups && g.key !== OTHERS));
  const label = (key: string) => (key === OTHERS ? 'Otros' : key);
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  // Arrastrar una tarjeta a otro grupo (ref: el dato llega a los handlers al instante; estado solo para pintar).
  const dragRef = useRef<TRow<Row> | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dropTarget = (key: string) => (!onMove || key === OTHERS ? {} : {
    onDragOver: (e: DragEvent) => {
      const d = dragRef.current;
      if (!d || String(d.getValue(boardField) ?? '') === key) return;
      e.preventDefault();
      setOver(key);
    },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(o => (o === key ? null : o)); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const d = dragRef.current;
      dragRef.current = null; setOver(null);
      if (d) onMove(d.original, key);
    },
  });

  const card = (r: TRow<Row>) => (
    <div key={r.id} className="dv-explorer__cell" draggable={!!onMove}
      onDragStart={e => { dragRef.current = r; onDragRow?.(r.original); e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { dragRef.current = null; onDragRow?.(null); setOver(null); }}>
      {renderCard ? renderCard(r.original, visible) : (
        <RecordCard row={r.original} fields={fields} titleField={titleField} ids={ids} href={rowHref?.(r.original)} actions={cardActions?.(r.original)} />
      )}
    </div>
  );
  const grid = (items: TRow<Row>[]) => items.length
    ? <div className="dv-explorer__grid">{items.map(card)}</div>
    : <p className="dv-explorer__empty">Sin registros{onMove ? '. Arrastra aquí una tarjeta para moverla.' : '.'}</p>;
  const actions = (key: string, items: TRow<Row>[]) =>
    groupActions && key !== OTHERS && <span className="dv-explorer__actions">{groupActions(key, items.map(r => r.original))}</span>;

  // Nombre del grupo: doble clic lo vuelve un campo (solo grupos reales y con onRenameGroup).
  const [editing, setEditing] = useState<string | null>(null);
  const name = (key: string) => {
    if (!onRenameGroup || key === OTHERS) return label(key);
    if (editing !== key) return <span className="dv-explorer__name-edit" title="Doble clic para renombrar" onDoubleClick={() => setEditing(key)}>{label(key)}</span>;
    const done = (v: string | null) => {
      setEditing(null);
      if (v && v.trim() && v.trim() !== key) onRenameGroup(key, v.trim()).catch(e => alert(e?.message || 'No se pudo renombrar.'));
    };
    return <input className="dv-explorer__rename" defaultValue={key} autoFocus aria-label={`Nuevo nombre para ${key}`} maxLength={100}
      onFocus={e => e.currentTarget.select()} onBlur={e => done(e.currentTarget.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = key; e.currentTarget.blur(); } }} />;
  };

  if (!groups.length) return <p className="dv-explorer__empty">Sin registros.</p>;
  return (
    <section className="dv-explorer__detail dv-cards" aria-label={title}>
      <header className="dv-explorer__head">
        <span><i className="fas fa-layer-group" aria-hidden /> {title}</span>
        <span className="dv-explorer__total">{total} {total === 1 ? 'registro' : 'registros'}</span>
      </header>
      {groups.map(g => (
        <div key={g.key} className={`dv-explorer__group${over === g.key ? ' is-over' : ''}`} {...mergeDrag(dropTarget(g.key), groupDropTarget(reorder, g.key))}>
          <h3 className="dv-explorer__subhead" {...groupDragSource(reorder, g.key)}>
            <i className={`fas ${g.icon ?? 'fa-folder'}`} aria-hidden /> {name(g.key)}
            <span className="dv-explorer__count">{g.items.length}</span>
            {actions(g.key, g.items)}
          </h3>
          {grid(g.items)}
        </div>
      ))}
    </section>
  );
}
