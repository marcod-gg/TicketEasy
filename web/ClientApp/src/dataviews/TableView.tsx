import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type React from 'react';
import { flexRender, type Row as TRow } from '@tanstack/react-table';
import { CopyButton } from './CopyButton';
import { GroupHeader, Title, Value } from './fields';
import { groupDragSource, groupDropTarget, mergeDrag, type Reorder } from './groupDrag';
import type { Row, ViewProps } from './types';

// Ancho fijo de la celda de acciones (rowActions): se suma al total para que la tabla no la recorte.

export function TableView({ table, rows, fields, titleField, sumField, collapsed, onToggle, rowHref, rowActions, rowActionsWidth = 96, groupActions, onRenameGroup, onMoveToGroup, groupReorder }: ViewProps & {
  /** Solo cuando la tabla está agrupada por el campo del tablero: mismas acciones de grupo que el tablero agrupado con tarjetas. */
  groupActions?: (value: string, rows: Row[]) => ReactNode;
  onRenameGroup?: (value: string, name: string) => Promise<void>;
  /** Arrastrar una fila al encabezado de otro grupo la mueve. */
  onMoveToGroup?: (row: Row, value: string) => void;
  /** Arrastrar una sección sobre otra cambia su orden (orden personalizado). */
  groupReorder?: Reorder;
}) {
  // Arrastre de filas a otro grupo (ref: el dato llega a los handlers al instante; estado solo para pintar).
  const rowDrag = useRef<TRow<Row> | null>(null);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const headers = table.getHeaderGroups()[0].headers;
  const multi = table.getState().sorting.length > 1;
  const resizing = !!table.getState().columnSizingInfo.isResizingColumn; // arrastrando un borde: sin transición ni reorden

  // Reorden de columnas por arrastre, con animación "agua" tipo iOS: al cruzar una columna, las demás
  // se corren a su nuevo lugar deslizándose (técnica FLIP: se mide antes/después y se anima la diferencia).
  const [drag, setDrag] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const before = useRef<Record<string, number> | null>(null); // left de cada columna ANTES del reorden

  const snapshot = () => {
    const el = tableRef.current;
    if (!el) return;
    const rects: Record<string, number> = {};
    el.querySelectorAll<HTMLElement>('thead [data-col]').forEach(th => { rects[th.dataset.col!] = th.getBoundingClientRect().left; });
    before.current = rects;
  };

  const reorder = (from: string, to: string) => {
    if (from === to) return;
    snapshot();
    const ids = table.getAllLeafColumns().map(c => c.id);
    ids.splice(ids.indexOf(to), 0, ids.splice(ids.indexOf(from), 1)[0]);
    table.setColumnOrder(ids);
  };

  // FLIP: tras cambiar el orden, cada columna arranca en su posición vieja (Invert) y desliza a la nueva (Play).
  const orderSig = headers.map(h => h.column.id).join(',');
  useLayoutEffect(() => {
    const first = before.current;
    before.current = null;
    const el = tableRef.current;
    if (!first || !el) return;
    el.querySelectorAll<HTMLElement>('thead [data-col]').forEach(th => {
      const id = th.dataset.col!;
      if (first[id] == null) return;
      const dx = first[id] - th.getBoundingClientRect().left;
      if (!dx) return;
      // Toda la columna (encabezado + celdas) se desplaza junta.
      const cells = el.querySelectorAll<HTMLElement>(`[data-col="${id}"]`);
      cells.forEach(cell => { cell.style.transition = 'none'; cell.style.transform = `translateX(${dx}px)`; });
      requestAnimationFrame(() => cells.forEach(cell => {
        cell.style.transition = 'transform .3s cubic-bezier(.2,.9,.2,1)';
        cell.style.transform = '';
      }));
    });
  }, [orderSig]);

  const leaf = (r: TRow<Row>) => (
    <tr key={r.id} draggable={!!onMoveToGroup}
      onDragStart={onMoveToGroup && (e => { rowDrag.current = r; e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; })}
      onDragEnd={onMoveToGroup && (() => { rowDrag.current = null; setOverGroup(null); })}>
      {r.getVisibleCells().map(c => (
        <td key={c.id} data-col={c.column.id} className={c.column.id === titleField ? 'dv-td--title' : undefined}>
          {c.column.id === titleField
            ? (
              // Columna obligatoria (p. ej. el ID): enlace al detalle + copiar rápido si el campo tiene copy.
              <span className="dv-idcell">
                <Title row={r.original} titleField={titleField} href={rowHref?.(r.original)} />
                {fields[titleField].copy && <CopyButton text={String(r.original[titleField] ?? '')} what={fields[titleField].label} />}
              </span>
            )
            : fields[c.column.id]?.copy && c.getValue()
            ? (
              // Campo con copia rápida (p. ej. Persona en Altas/Bajas).
              <span className="dv-idcell">
                <Value field={fields[c.column.id]} value={c.getValue()} />
                <CopyButton text={String(c.getValue() ?? '')} what={fields[c.column.id].label} />
              </span>
            )
            : <Value field={fields[c.column.id]} value={c.getValue()} />}
        </td>
      ))}
      {rowActions && <td className="dv-td--actions"><div className="dv-actions">{rowActions(r.original)}</div></td>}
    </tr>
  );

  return (
    <div className="dv-tablewrap">
      <table className={`dv-table${resizing ? ' dv-resizing' : ''}`} ref={tableRef} style={{ width: table.getTotalSize() + (rowActions ? rowActionsWidth : 0) }}>
        <thead>
          <tr>
            {headers.map(h => {
              const dir = h.column.getIsSorted();
              return (
                <th
                  key={h.id}
                  data-col={h.column.id}
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
                  draggable={!resizing}
                  onDragStart={() => setDrag(h.column.id)}
                  // Reorden en vivo al cruzar: las columnas se acomodan mientras arrastras (efecto agua).
                  onDragEnter={() => { if (drag && drag !== h.column.id) reorder(drag, h.column.id); }}
                  onDragOver={e => { if (drag) e.preventDefault(); }}
                  onDrop={e => { e.preventDefault(); setDrag(null); }}
                  onDragEnd={() => setDrag(null)}
                  style={{ width: h.getSize(), cursor: 'grab', opacity: drag === h.column.id ? 0.4 : undefined }}
                >
                  <button type="button" className="dv-th" onClick={h.column.getToggleSortingHandler()} title="Arrastra para reordenar · Clic: ordenar · Shift+clic: agregar criterio">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    {dir && <i className={`fas fa-arrow-${dir === 'asc' ? 'up' : 'down'}`} aria-hidden />}
                    {dir && multi && <sup>{h.column.getSortIndex() + 1}</sup>}
                  </button>
                  {/* Borde derecho: arrastrar para alargar/acortar la columna (no dispara reorden ni orden). */}
                  <div
                    className={`dv-resizer${h.column.getIsResizing() ? ' is-resizing' : ''}`}
                    onMouseDown={e => { e.stopPropagation(); h.getResizeHandler()(e); }}
                    onTouchStart={e => { e.stopPropagation(); h.getResizeHandler()(e); }}
                    onClick={e => e.stopPropagation()}
                    onDragStart={e => e.preventDefault()}
                    draggable={false}
                    aria-hidden
                  />
                </th>
              );
            })}
            {rowActions && <th className="dv-th--actions" style={{ width: rowActionsWidth }}><span className="dv-sr">Acciones</span></th>}
          </tr>
        </thead>
        <tbody>
          {/* rows ya viene aplanada y paginada: encabezado de grupo seguido de sus filas visibles. */}
          {rows.map(r =>
            r.getIsGrouped() ? (
              <tr key={r.id} className={`dv-grouprow${overGroup === r.id ? ' is-over' : ''}`}
                {...mergeDrag(onMoveToGroup ? {
                  onDragOver: (e: React.DragEvent) => {
                    const d = rowDrag.current;
                    if (!d || d.parentId === r.id) return;
                    e.preventDefault(); setOverGroup(r.id);
                  },
                  onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverGroup(g => (g === r.id ? null : g)); },
                  onDrop: (e: React.DragEvent) => {
                    e.preventDefault();
                    const d = rowDrag.current;
                    rowDrag.current = null; setOverGroup(null);
                    if (d) onMoveToGroup(d.original, String(r.groupingValue ?? ''));
                  },
                } : {}, groupDropTarget(groupReorder, String(r.groupingValue ?? '')))}>
                <td colSpan={headers.length + (rowActions ? 1 : 0)}>
                  <GroupHeader row={r} fields={fields} sumField={sumField} collapsed={!!collapsed[r.id]} onToggle={() => onToggle(r.id)}
                    dragProps={groupDragSource(groupReorder, String(r.groupingValue ?? ''))}
                    actions={groupActions?.(String(r.groupingValue ?? ''), r.subRows.map(x => x.original))}
                    onRename={onRenameGroup && (name => onRenameGroup(String(r.groupingValue ?? ''), name))} />
                </td>
              </tr>
            ) : (
              leaf(r)
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
