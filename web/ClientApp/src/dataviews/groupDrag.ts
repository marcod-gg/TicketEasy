import type { DragEvent, HTMLAttributes } from 'react';
import { moveTo } from './rules';

// Arrastrar para reordenar grupos (segmentos, secciones, columnas, subtítulos). Usa su propio tipo de dato para no
// mezclarse con el arrastre de tarjetas y filas, que mueve registros de un grupo a otro.
const MIME = 'application/x-dv-group';
let dragging: { field: string; key: string } | null = null;

/** Orden de un select que se puede reordenar arrastrando: sus valores en el orden actual y qué hacer con el nuevo. */
export interface Reorder { field: string; keys: string[]; onReorder: (keys: string[]) => void }

const clearOver = () => document.querySelectorAll('.is-reorder').forEach(el => el.classList.remove('is-reorder'));
const accepts = (e: DragEvent, r: Reorder, key: string) =>
  e.dataTransfer.types.includes(MIME) && dragging?.field === r.field && dragging.key !== key;

/** Lo que se toma para arrastrar (botón del segmento, encabezado de la columna o de la sección). */
export function groupDragSource(r: Reorder | undefined, key: string): HTMLAttributes<HTMLElement> {
  if (!r?.keys.includes(key)) return {};
  return {
    draggable: true,
    onDragStart: e => { e.stopPropagation(); dragging = { field: r.field, key }; e.dataTransfer.setData(MIME, key); e.dataTransfer.effectAllowed = 'move'; },
    onDragEnd: () => { dragging = null; clearOver(); },
  };
}

/** Donde se suelta: el grupo arrastrado queda en el lugar de este. */
export function groupDropTarget(r: Reorder | undefined, key: string): HTMLAttributes<HTMLElement> {
  if (!r?.keys.includes(key)) return {};
  return {
    onDragOver: e => {
      if (!accepts(e, r, key)) return;
      e.preventDefault(); e.stopPropagation();
      if (!e.currentTarget.classList.contains('is-reorder')) { clearOver(); e.currentTarget.classList.add('is-reorder'); }
    },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) e.currentTarget.classList.remove('is-reorder'); },
    onDrop: e => {
      if (!accepts(e, r, key)) return;
      e.preventDefault(); e.stopPropagation();
      const from = dragging!.key;
      dragging = null; clearOver();
      r.onReorder(moveTo(r.keys, from, key));
    },
  };
}

/** Une handlers de arrastre de dos orígenes (p. ej. soltar tarjetas y reordenar grupos) sobre el mismo elemento. */
export function mergeDrag(...all: HTMLAttributes<HTMLElement>[]): HTMLAttributes<HTMLElement> {
  const out: Record<string, unknown> = {};
  for (const props of all) for (const [k, v] of Object.entries(props)) {
    const prev = out[k];
    out[k] = typeof v === 'function' && typeof prev === 'function'
      ? (...args: unknown[]) => { (prev as (...a: unknown[]) => void)(...args); (v as (...a: unknown[]) => void)(...args); }
      : v;
  }
  return out as HTMLAttributes<HTMLElement>;
}
