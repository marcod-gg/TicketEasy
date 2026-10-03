import type { HTMLAttributes } from 'react';

export interface RailItem {
  key: string;
  label: string;
  icon?: string; // clase Font Awesome; sin ícono, carpeta
  count: number;
}

/**
 * Segmentos (ícono, nombre y cantidad) a la izquierda de Tabla, Tablero y Tarjetas.
 * Bajo 768 px pasa a una barra arriba con ícono y cantidad; el nombre queda solo en el elegido (y en title/aria).
 */
export function GroupRail({ label, items, current, onPick, over, itemProps }: {
  label: string;
  items: RailItem[];
  current: string;
  onPick: (key: string) => void;
  over?: string | null; // grupo que recibe un arrastre (Tarjetas con onMove)
  itemProps?: (key: string) => HTMLAttributes<HTMLButtonElement>;
}) {
  return (
    <nav className="dv-explorer__list" aria-label={label}>
      {items.map(g => (
        <button key={g.key} type="button" title={g.label}
          className={`dv-explorer__item${g.key === current ? ' is-active' : ''}${over === g.key ? ' is-over' : ''}`}
          aria-pressed={g.key === current} onClick={() => onPick(g.key)} {...itemProps?.(g.key)}>
          <span className="dv-explorer__icon" aria-hidden><i className={`fas ${g.icon ?? 'fa-folder'}`} /></span>
          <span className="dv-explorer__name">{g.label}</span>
          <span className="dv-explorer__count">{g.count}</span>
        </button>
      ))}
    </nav>
  );
}
