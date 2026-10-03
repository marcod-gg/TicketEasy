import { moveKey } from './rules';
import { groupDragSource, groupDropTarget, mergeDrag, type Reorder } from './groupDrag';
import type { Fields } from './types';

/**
 * Orden personalizado de los grupos en uso (segmentos, secciones, columnas o subtítulos), solo selects.
 * Cada valor se arrastra o sube y baja con sus flechas; "Todos" no entra (siempre va primero). "Restablecer" vuelve al orden del esquema.
 */
export function GroupOrderEditor({ fields, groups, order, onChange }: {
  /** Esquema con el orden ya aplicado. */
  fields: Fields;
  /** Campos agrupando la vista, con su rol: p. ej. [{ id: 'bodega', role: 'Segmentos' }]. */
  groups: { id: string; role: string }[];
  order: Record<string, string[]>;
  onChange: (order: Record<string, string[]>) => void;
}) {
  if (!groups.length) return null;
  return (
    <div className="dv-editor dv-gorder">
      <b>Orden de grupos</b>
      {groups.map(({ id, role }) => {
        const keys = fields[id].options!.map(o => o.value);
        const custom = !!order[id]?.length;
        const set = (next: string[] | null) => {
          const { [id]: _, ...rest } = order;
          onChange(next ? { ...rest, [id]: next } : rest);
        };
        const drag: Reorder = { field: id, keys, onReorder: set };
        return (
          <div key={id} className="dv-gorder__group">
            <div className="dv-gorder__head">
              <span>{role} · {fields[id].label}</span>
              <span className="dv-muted">{custom ? 'Personalizado' : 'Predeterminado'}</span>
              {custom && <button type="button" className="dv-link" onClick={() => set(null)}>Restablecer</button>}
            </div>
            <ol className="dv-gorder__list" aria-label={`Orden de ${fields[id].label}`}>
              {keys.map((k, i) => (
                <li key={k} {...mergeDrag(groupDragSource(drag, k), groupDropTarget(drag, k))}>
                  <i className="fas fa-grip-vertical dv-gorder__grip" aria-hidden />
                  <span className="dv-gorder__name">{k}</span>
                  <button type="button" className="dv-icon" disabled={i === 0} aria-label={`Subir ${k}`} onClick={() => set(moveKey(keys, k, -1))}>
                    <i className="fas fa-arrow-up" aria-hidden />
                  </button>
                  <button type="button" className="dv-icon" disabled={i === keys.length - 1} aria-label={`Bajar ${k}`} onClick={() => set(moveKey(keys, k, 1))}>
                    <i className="fas fa-arrow-down" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
