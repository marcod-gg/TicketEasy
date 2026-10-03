import type { Row as TRow, SortingState, Table } from '@tanstack/react-table';
import type { StylePrefs } from './StyleMenu';

export type FieldType = 'text' | 'select' | 'number' | 'date';

export interface SelectOption {
  value: string;
  color?: string; // cualquier color CSS, p. ej. 'var(--c-nuevo)'
  icon?: string; // clase Font Awesome (p. ej. 'fa-circle-check'); se usa en las columnas del tablero
}

export interface FieldDef {
  label: string;
  type: FieldType;
  options?: SelectOption[]; // solo select; su orden define el orden de grupos y del sort
  copy?: boolean; // muestra un botón de copia rápida junto al valor en la tabla
  size?: number; // ancho inicial de la columna en px (el usuario lo puede cambiar arrastrando)
}

export type Fields = Record<string, FieldDef>;

export interface FilterRule {
  id: string;
  col: string;
  op: string;
  value: string;
  join?: 'and' | 'or'; // unión con la regla anterior; 'y' pesa más que 'o': A y B o C = (A y B) o C
}

/** Grupo de filtros: sus reglas se evalúan juntas, como un paréntesis, y se une al resto por su join. */
export interface FilterGroup {
  id: string;
  rules: FilterRule[];
  join?: 'and' | 'or';
}

export type FilterItem = FilterRule | FilterGroup;

export type ViewType = 'table' | 'board' | 'cards'; // cards = tablero agrupado con tarjetas (ExplorerView)

// Lo que se persiste: todo serializable a JSON.
export interface ViewConfig {
  id: string;
  name: string;
  type: ViewType;
  types?: ViewType[]; // diseños que muestra esta vista (Configuración); ausente = todos los ofrecidos
  tools?: Record<string, boolean>; // herramientas apagadas en esta vista ({ sort: false }); ausente = todas las del montaje
  source: string; // alcance de datos (DataViews lo carga con load(source)); p. ej. tickets creados por mí / asignados / todos
  filters: FilterItem[]; // reglas y grupos combinados con y / o (ver matchFilters)
  groupBy: string; // '' = sin agrupar; tabla: secciones; tablero: columnas; tarjetas: subtítulos (select)
  groupOrder?: Record<string, string[]>; // orden personalizado de los valores de un select (segmentos, secciones, columnas, subtítulos)
  boardOpen?: Record<string, string[]>; // tablero: columnas abiertas por campo de columnas (la más reciente primero)
  railBy?: string; // segmentos según esta propiedad, iguales en los tres diseños; ''/ausente = sin lista
  sorting: SortingState;
  order?: string[]; // columnOrder (arrastre de columnas en la tabla); vacío/ausente = orden de FIELDS
  sizes?: Record<string, number>; // columnSizing: ancho por columna al arrastrar el borde; ausente = size de FIELDS
  hidden: Record<string, boolean>; // columnVisibility: { colId: false }
  search: string;
  pageSize?: number; // filas por página en tabla y lista; 0 = todas (por defecto 25)
  style?: Partial<StylePrefs>; // Estilo de esta vista (menú «…»); ausente = STYLE_DEFAULTS
}

export type Row = Record<string, unknown>;

/** Lo que DataViews entrega a cada vista: todas renderizan el mismo useReactTable. */
export interface ViewProps {
  table: Table<Row>;
  rows: TRow<Row>[]; // tabla/lista: página aplanada (encabezados de grupo + filas); tablero y tarjetas: todas las filas
  fields: Fields;
  titleField: string;
  sumField?: string;
  collapsed: Record<string, boolean>;
  onToggle: (groupRowId: string) => void;
  rowHref?: (row: Row) => string;
  rowActions?: (row: Row) => import('react').ReactNode; // celda final con acciones (no es columna: no se ordena ni filtra)
  rowActionsWidth?: number; // ancho de esa celda en px
}
