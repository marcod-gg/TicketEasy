import type { ReactNode } from 'react';
import { Title, Value, formatValue } from './fields';
import type { Fields, Row } from './types';

/**
 * Tarjeta por defecto de Tablero y Tarjetas: título, selects como etiquetas, el resto como etiqueta: valor y acciones al pie.
 * El acento del borde es el color del primer select con color (normalmente el estado; sin color no hay acento). El nombre va en la etiqueta.
 */
export function RecordCard({ row, fields, titleField, ids, href, actions }: {
  row: Row;
  fields: Fields;
  titleField: string;
  /** Propiedades visibles, sin el título ni el campo que agrupa (sería igual en toda la columna). */
  ids: string[];
  href?: string;
  actions?: ReactNode;
}) {
  const filled = ids.filter(id => formatValue(fields[id], row[id]));
  const tags = filled.filter(id => fields[id].type === 'select');
  const meta = filled.filter(id => fields[id].type !== 'select');
  const accent = tags.map(id => fields[id].options?.find(o => o.value === String(row[id]))?.color).find(Boolean);
  return (
    <article className={`dv-card${accent ? ' dv-card--accent' : ''}`} style={accent ? { ['--accent' as string]: accent } : undefined}>
      <Title row={row} titleField={titleField} href={href} />
      {tags.length > 0 && (
        <div className="dv-card__tags">
          {tags.map(id => (
            <span key={id} title={fields[id].label}><span className="dv-sr">{fields[id].label}: </span><Value field={fields[id]} value={row[id]} /></span>
          ))}
        </div>
      )}
      {meta.length > 0 && (
        <dl className="dv-card__meta">
          {meta.map(id => (
            <div key={id}>
              <dt>{fields[id].label}</dt>
              <dd className={`dv-card__v--${fields[id].type}`} title={formatValue(fields[id], row[id])}><Value field={fields[id]} value={row[id]} /></dd>
            </div>
          ))}
        </dl>
      )}
      {actions && <footer className="dv-card__foot">{actions}</footer>}
    </article>
  );
}
