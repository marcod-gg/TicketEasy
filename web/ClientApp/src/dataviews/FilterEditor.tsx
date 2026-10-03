import { OPERATORS, findOperator, isGroup } from './rules';
import { newId } from './useViews';
import type { Fields, FilterItem, FilterRule } from './types';

type Join = 'and' | 'or';

/** Reglas y grupos de filtros (un nivel de grupos). Cada regla ocupa una línea. */
export function FilterEditor({ fields, filters, onChange }: {
  fields: Fields;
  filters: FilterItem[];
  onChange: (filters: FilterItem[]) => void;
}) {
  return (
    <div className="dv-editor dv-filters">
      {filters.length === 0 && <p className="dv-muted dv-editor__empty">Sin filtros. Une reglas con “y” u “o”; “y” se evalúa primero. Usa un grupo para evaluar varias reglas juntas.</p>}
      <FilterList fields={fields} items={filters} onChange={onChange} />
    </div>
  );
}

function FilterList({ fields, items, onChange, nested = false }: {
  fields: Fields;
  items: FilterItem[];
  onChange: (items: FilterItem[]) => void;
  nested?: boolean;
}) {
  const colIds = Object.keys(fields);
  const firstOp = (col: string) => OPERATORS[fields[col].type][0].id;
  const newRule = (): FilterRule => ({ id: newId(), col: colIds[0], op: firstOp(colIds[0]), value: '' });
  const set = (id: string, patch: Partial<FilterItem>) => onChange(items.map(f => (f.id === id ? ({ ...f, ...patch } as FilterItem) : f)));
  const remove = (id: string) => onChange(items.filter(f => f.id !== id));

  return (
    <>
      {items.map((f, i) => {
        const join = i === 0 ? <span className="dv-editor__join">Donde</span> : (
          <select className="dv-editor__join" aria-label="Unión con la regla anterior" value={f.join ?? 'and'}
            onChange={e => set(f.id, { join: e.target.value as Join })}>
            <option value="and">y</option>
            <option value="or">o</option>
          </select>
        );
        if (isGroup(f)) {
          return (
            <div key={f.id} className="dv-editor__row dv-editor__row--group">
              {join}
              <div className="dv-fgroup" role="group" aria-label="Grupo de filtros">
                <FilterList fields={fields} items={f.rules} nested
                  onChange={rules => (rules.length ? set(f.id, { rules: rules as FilterRule[] }) : remove(f.id))} />
                <button type="button" className="dv-link" onClick={() => set(f.id, { rules: [...f.rules, { ...newRule(), join: 'and' }] })}>
                  <i className="fas fa-plus" aria-hidden /> Agregar filtro al grupo
                </button>
              </div>
              <button type="button" className="dv-icon" aria-label="Quitar grupo" onClick={() => remove(f.id)}>
                <i className="fas fa-trash-can" aria-hidden />
              </button>
            </div>
          );
        }
        const field = fields[f.col];
        if (!field) return null;
        const op = findOperator(field.type, f.op);
        return (
          <div key={f.id} className="dv-editor__row">
            {join}
            <select aria-label="Propiedad" value={f.col} onChange={e => set(f.id, { col: e.target.value, op: firstOp(e.target.value), value: '' })}>
              {colIds.map(c => <option key={c} value={c}>{fields[c].label}</option>)}
            </select>
            <select aria-label="Operador" value={f.op} onChange={e => set(f.id, { op: e.target.value, value: '' })}>
              {OPERATORS[field.type].map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            {op?.needsValue &&
              (op.id === 'between' ? (
                <>
                  <input aria-label="Desde" type="date" value={f.value.split('|')[0] ?? ''}
                    onChange={e => set(f.id, { value: `${e.target.value}|${f.value.split('|')[1] ?? ''}` })} />
                  <input aria-label="Hasta" type="date" value={f.value.split('|')[1] ?? ''}
                    onChange={e => set(f.id, { value: `${f.value.split('|')[0] ?? ''}|${e.target.value}` })} />
                </>
              ) : op.id === 'within' ? (
                <input aria-label="Días hacia atrás y adelante" type="number" min={0} value={f.value} placeholder="Días" style={{ width: 80 }}
                  onChange={e => set(f.id, { value: e.target.value })} />
              ) : field.type === 'select' ? (
                <select aria-label="Valor" value={f.value} onChange={e => set(f.id, { value: e.target.value })}>
                  <option value="">Elegir…</option>
                  {field.options?.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
                </select>
              ) : (
                <input
                  aria-label="Valor"
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  value={f.value}
                  placeholder="Valor"
                  onChange={e => set(f.id, { value: e.target.value })}
                />
              ))}
            <button type="button" className="dv-icon" aria-label="Quitar filtro" onClick={() => remove(f.id)}>
              <i className="fas fa-xmark" aria-hidden />
            </button>
          </div>
        );
      })}
      {!nested && (
        <div className="dv-editor__add">
          <button type="button" className="dv-link" onClick={() => onChange([...items, { ...newRule(), join: 'and' }])}>
            <i className="fas fa-plus" aria-hidden /> Agregar filtro
          </button>
          <button type="button" className="dv-link" onClick={() => onChange([...items, { id: newId(), join: 'and', rules: [newRule()] }])}>
            <i className="fas fa-layer-group" aria-hidden /> Agregar grupo de filtros
          </button>
        </div>
      )}
    </>
  );
}
