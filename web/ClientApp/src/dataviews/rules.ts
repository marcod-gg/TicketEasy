import type { FieldDef, FieldType, Fields, FilterGroup, FilterItem, FilterRule, Row } from './types';

export interface Operator {
  id: string;
  label: string;
  needsValue: boolean;
}

export const OPERATORS: Record<FieldType, Operator[]> = {
  text: [
    { id: 'contains', label: 'contiene', needsValue: true },
    { id: 'notContains', label: 'no contiene', needsValue: true },
    { id: 'is', label: 'es', needsValue: true },
    { id: 'empty', label: 'está vacío', needsValue: false },
    { id: 'notEmpty', label: 'no está vacío', needsValue: false },
  ],
  select: [
    { id: 'is', label: 'es', needsValue: true },
    { id: 'isNot', label: 'no es', needsValue: true },
    { id: 'empty', label: 'está vacío', needsValue: false },
    { id: 'notEmpty', label: 'no está vacío', needsValue: false },
  ],
  number: [
    { id: 'eq', label: '=', needsValue: true },
    { id: 'gt', label: '>', needsValue: true },
    { id: 'lt', label: '<', needsValue: true },
    { id: 'gte', label: '≥', needsValue: true },
    { id: 'lte', label: '≤', needsValue: true },
  ],
  date: [
    { id: 'before', label: 'antes de', needsValue: true },
    { id: 'after', label: 'después de', needsValue: true },
    { id: 'on', label: 'es', needsValue: true },
    { id: 'between', label: 'entre', needsValue: true }, // value 'desde|hasta'
    { id: 'within', label: '± días de hoy', needsValue: true }, // value = días; se recalcula cada día
    { id: 'empty', label: 'está vacía', needsValue: false },
    { id: 'notEmpty', label: 'no está vacía', needsValue: false },
  ],
};

export const findOperator = (type: FieldType, op: string) => OPERATORS[type].find(o => o.id === op);

/** Regla incompleta (operador desconocido o sin valor requerido) = no filtra. */
export function isComplete(field: FieldDef | undefined, rule: FilterRule): boolean {
  const op = field && findOperator(field.type, rule.op);
  if (!op) return false;
  if (op.id === 'between') return rule.value.split('|').every(v => v.trim() !== '') && rule.value.includes('|');
  return !op.needsValue || rule.value.trim() !== '';
}

/** Normaliza a 'yyyy-mm-dd'. Acepta ISO y dd-mm-yyyy / dd/mm/yyyy (formato es-CL del SP). */
export function toISODate(v: unknown): string {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

const str = (v: unknown) => (v == null ? '' : String(v)).trim();

export function matchRule(field: FieldDef, rule: FilterRule, cell: unknown): boolean {
  if (!isComplete(field, rule)) return true;
  const val = str(cell);
  const q = rule.value.trim();
  switch (field.type) {
    case 'text': {
      const a = val.toLowerCase(), b = q.toLowerCase();
      switch (rule.op) {
        case 'contains': return a.includes(b);
        case 'notContains': return !a.includes(b);
        case 'is': return a === b;
        case 'empty': return a === '';
        case 'notEmpty': return a !== '';
      }
      return true;
    }
    case 'select':
      switch (rule.op) {
        case 'is': return val === q;
        case 'isNot': return val !== q;
        case 'empty': return val === '';
        case 'notEmpty': return val !== '';
      }
      return true;
    case 'number': {
      if (val === '') return false;
      const a = Number(val), b = Number(q);
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      switch (rule.op) {
        case 'eq': return a === b;
        case 'gt': return a > b;
        case 'lt': return a < b;
        case 'gte': return a >= b;
        case 'lte': return a <= b;
      }
      return true;
    }
    case 'date': {
      const a = toISODate(val);
      if (rule.op === 'empty') return !a;
      if (rule.op === 'notEmpty') return !!a;
      if (rule.op === 'within') {
        const n = Number(q), d = new Date();
        if (!a || Number.isNaN(n)) return false;
        const day = (k: number) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
        return a >= day(-n) && a <= day(n);
      }
      if (rule.op === 'between') {
        const [from, to] = q.split('|').map(toISODate);
        return !!a && a >= from && a <= to;
      }
      const b = toISODate(q);
      if (!a || !b) return false;
      switch (rule.op) {
        case 'before': return a < b;
        case 'after': return a > b;
        case 'on': return a === b;
      }
      return true;
    }
  }
}

export const isGroup = (f: FilterItem): f is FilterGroup => 'rules' in f;

/** Filtra algo: regla completa, o grupo con al menos una regla completa. */
export const isActive = (f: FilterItem, fields: Fields): boolean =>
  isGroup(f) ? f.rules.some(r => isActive(r, fields)) : isComplete(fields[f.col], f);

/**
 * Reglas y grupos activos unidos con y / o; 'y' pesa más: se parte en bloques por cada 'o' y basta con que un bloque cumpla.
 * Un grupo se evalúa entero (con la misma regla por dentro) y cuenta como una sola condición.
 */
export function matchFilters(filters: FilterItem[], fields: Fields, row: Row): boolean {
  const blocks: FilterItem[][] = [];
  for (const f of filters) {
    if (!isActive(f, fields)) continue;
    if (!blocks.length || f.join === 'or') blocks.push([f]);
    else blocks[blocks.length - 1].push(f);
  }
  return !blocks.length || blocks.some(b => b.every(f => (isGroup(f) ? matchFilters(f.rules, fields, row) : matchRule(fields[f.col], f, row[f.col]))));
}

/** Búsqueda de la barra: texto en cualquier campo, sin distinguir mayúsculas (como includesString de TanStack). */
export function matchSearch(search: string, fields: Fields, row: Row): boolean {
  const q = search.trim().toLowerCase();
  return !q || Object.keys(fields).some(k => str(row[k]).toLowerCase().includes(q));
}

/** Clave de grupo de la lista lateral: fechas por día, el resto por texto; '' = sin valor. */
export const railKey = (field: FieldDef, v: unknown) => (field.type === 'date' ? toISODate(v) : str(v));

/** Grupos de la lista lateral con su cantidad, en el orden del campo (select por opción, desconocidos al final; sin valor al último). */
export function railGroups(field: FieldDef, col: string, rows: Row[], withEmpty = false): { key: string; icon?: string; count: number }[] {
  // withEmpty: también las opciones del select sin registros (para soltar tarjetas en ellas).
  const counts = new Map<string, number>(withEmpty ? (field.options ?? []).map(o => [o.value, 0]) : []);
  for (const r of rows) {
    const k = railKey(field, r[col]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.keys()]
    .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : compareValues(field, a, b)))
    .map(key => ({ key, icon: field.options?.find(o => o.value === key)?.icon, count: counts.get(key)! }));
}

/** Texto del valor de una regla para el resumen de filtros. */
export function ruleValueLabel(rule: FilterRule): string {
  if (rule.op === 'between') return rule.value.split('|').join(' – ');
  if (rule.op === 'within') return `${rule.value} días`;
  return rule.value;
}

/** Texto de una regla o grupo activo (resumen y descarga): "Región es «13»", "(A o B)". */
export function describeFilter(f: FilterItem, fields: Fields): string {
  if (isGroup(f)) {
    const parts = f.rules.filter(r => isActive(r, fields));
    return `(${parts.map((r, i) => `${i > 0 ? (r.join === 'or' ? 'o ' : 'y ') : ''}${describeFilter(r, fields)}`).join(' ')})`;
  }
  const field = fields[f.col], op = findOperator(field.type, f.op)!;
  return `${field.label} ${op.label}${op.needsValue ? ` «${ruleValueLabel(f)}»` : ''}`;
}

/** Comparador por tipo: select por índice de opción (desconocidos al final), date por fecha, number numérico. */
export function compareValues(field: FieldDef, a: unknown, b: unknown): number {
  if (field.type === 'select') {
    const idx = (v: unknown) => {
      const i = (field.options ?? []).findIndex(o => o.value === str(v));
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return idx(a) - idx(b) || str(a).localeCompare(str(b), 'es');
  }
  if (field.type === 'number') return (Number(a) || 0) - (Number(b) || 0);
  if (field.type === 'date') return toISODate(a).localeCompare(toISODate(b));
  return str(a).localeCompare(str(b), 'es', { sensitivity: 'base' });
}

export const PAGE_SIZES = [25, 50, 100, 0]; // 0 = todos

/**
 * Página de una lista aplanada (encabezados de grupo + filas). size 0 = todas.
 * Si la página empieza dentro de un grupo, repite su encabezado para no perder el contexto.
 */
export function paginate<T>(flat: T[], page: number, size: number, isGroup: (r: T) => boolean) {
  const per = size > 0 ? size : Math.max(flat.length, 1);
  const pageCount = Math.max(1, Math.ceil(flat.length / per));
  const index = Math.min(Math.max(page, 0), pageCount - 1);
  const start = index * per;
  const rows = flat.slice(start, start + per);
  if (rows.length && !isGroup(rows[0])) {
    for (let i = start - 1; i >= 0; i--) {
      if (isGroup(flat[i])) {
        rows.unshift(flat[i]);
        break;
      }
    }
  }
  return { rows, index, pageCount };
}

export interface BoardFit {
  expanded: number; // columnas que se muestran completas (desde la izquierda, según prioridad)
  bar: 'none' | 'side' | 'top'; // dónde van las colapsadas: barra lateral derecha o fila superior (angosto)
}

/**
 * Cuántas columnas del tablero caben a `width` px (ancho útil del tablero) con un mínimo `min` por columna.
 * Si no caben todas, las restantes se colapsan en una barra: lateral (ancho `bar`) o arriba si width < narrow.
 */
// max: tope de columnas completas aunque quepan más (el resto va a la barra, como en una pantalla mediana).
export function fitColumns(width: number, n: number, { min = 240, gap = 14, bar = 200, narrow = 560, max = Infinity } = {}): BoardFit {
  if (width <= 0) return { expanded: Math.min(n, max), bar: n > max ? 'side' : 'none' }; // aún sin medir
  if (n <= max && n * min + (n - 1) * gap <= width) return { expanded: n, bar: 'none' };
  if (width < narrow) return { expanded: Math.max(1, Math.min(max, Math.floor((width + gap) / (min + gap)))), bar: 'top' };
  return { expanded: Math.max(1, Math.min(max, Math.floor((width - bar) / (min + gap)))), bar: 'side' };
}

/** Columnas abiertas del tablero: las guardadas (la más reciente primero) o, sin guardar, las primeras; hasta el límite. */
export function openColumns(keys: string[], saved: string[] | undefined, limit: number): string[] {
  return (saved ? saved.filter(k => keys.includes(k)) : keys).slice(0, limit);
}

/** Abrir una columna: pasa al frente y, si se supera el límite, se colapsa la abierta hace más tiempo. */
export const openColumn = (open: string[], key: string, limit: number) => [key, ...open.filter(k => k !== key)].slice(0, limit);

/**
 * Orden personalizado de grupos (por vista): reordena las opciones de cada select según la lista guardada; las que no
 * están en la lista (p. ej. opciones nuevas) van al final en su orden original. Segmentos, secciones, columnas del tablero
 * y subtítulos ordenan por índice de opción, así que todos lo respetan.
 */
export function withGroupOrder(fields: Fields, order?: Record<string, string[]>): Fields {
  if (!order) return fields;
  let out = fields;
  for (const [id, keys] of Object.entries(order)) {
    const opts = fields[id]?.type === 'select' ? fields[id].options : undefined;
    if (!opts || !keys.length) continue;
    const rank = (v: string, i: number) => { const k = keys.indexOf(v); return k < 0 ? keys.length + i : k; };
    const sorted = opts.map((o, i) => ({ o, r: rank(o.value, i) })).sort((a, b) => a.r - b.r).map(x => x.o);
    out = { ...out, [id]: { ...fields[id], options: sorted } };
  }
  return out;
}

/** Mueve un valor una posición (−1 arriba, +1 abajo) dentro del orden. */
export function moveKey(keys: string[], key: string, dir: -1 | 1): string[] {
  const i = keys.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return keys;
  const next = [...keys];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Arrastrar `from` sobre `to`: queda en el lugar de `to` (antes si sube, después si baja). */
export function moveTo(keys: string[], from: string, to: string): string[] {
  const i = keys.indexOf(from), j = keys.indexOf(to);
  if (i < 0 || j < 0 || i === j) return keys;
  const next = keys.filter(k => k !== from);
  next.splice(j, 0, from);
  return next;
}
