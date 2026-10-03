import type { SortingState } from '@tanstack/react-table';
import type { Fields } from './types';

export function SortEditor({ fields, sorting, onChange }: {
  fields: Fields;
  sorting: SortingState;
  onChange: (sorting: SortingState) => void;
}) {
  const used = new Set(sorting.map(s => s.id));
  const free = Object.keys(fields).filter(id => !used.has(id));
  const set = (i: number, patch: Partial<SortingState[number]>) => onChange(sorting.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="dv-editor">
      {sorting.length === 0 && <p className="dv-muted dv-editor__empty">Sin orden. Tip: Shift+clic en un encabezado de la tabla agrega criterios.</p>}
      {sorting.map((s, i) => (
        <div key={s.id} className="dv-editor__row">
          <span className="dv-editor__join">{i === 0 ? 'Por' : 'luego'}</span>
          <select aria-label="Propiedad" value={s.id} onChange={e => set(i, { id: e.target.value })}>
            {[s.id, ...free].map(id => <option key={id} value={id}>{fields[id]?.label ?? id}</option>)}
          </select>
          <select aria-label="Dirección" value={s.desc ? 'desc' : 'asc'} onChange={e => set(i, { desc: e.target.value === 'desc' })}>
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
          <button type="button" className="dv-icon" aria-label="Quitar criterio" onClick={() => onChange(sorting.filter((_, j) => j !== i))}>
            <i className="fas fa-xmark" aria-hidden />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <button type="button" className="dv-link" onClick={() => onChange([...sorting, { id: free[0], desc: false }])}>
          <i className="fas fa-plus" aria-hidden /> Agregar criterio
        </button>
      )}
    </div>
  );
}
