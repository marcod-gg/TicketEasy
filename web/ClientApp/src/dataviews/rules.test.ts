import { describe, expect, it } from 'vitest';
import { compareValues, fitColumns, matchFilters, matchRule, matchSearch, moveKey, moveTo, openColumn, openColumns, paginate, railGroups, toISODate, withGroupOrder } from './rules';
import type { FieldDef, Fields, FilterRule } from './types';

const text: FieldDef = { label: 'T', type: 'text' };
const select: FieldDef = { label: 'S', type: 'select', options: [{ value: 'Nuevo' }, { value: 'En curso' }, { value: 'Resuelto' }] };
const num: FieldDef = { label: 'N', type: 'number' };
const date: FieldDef = { label: 'D', type: 'date' };
const r = (op: string, value = '', col = 'x'): FilterRule => ({ id: op, col, op, value });

describe('matchRule', () => {
  it('text', () => {
    expect(matchRule(text, r('contains', 'SAP'), 'Soporte sap')).toBe(true);
    expect(matchRule(text, r('notContains', 'sap'), 'Soporte SAP')).toBe(false);
    expect(matchRule(text, r('is', 'alta'), 'Alta')).toBe(true);
    expect(matchRule(text, r('empty'), '')).toBe(true);
    expect(matchRule(text, r('empty'), null)).toBe(true);
    expect(matchRule(text, r('notEmpty'), 'x')).toBe(true);
  });
  it('select', () => {
    expect(matchRule(select, r('is', 'Nuevo'), 'Nuevo')).toBe(true);
    expect(matchRule(select, r('isNot', 'Nuevo'), 'Nuevo')).toBe(false);
    expect(matchRule(select, r('empty'), undefined)).toBe(true);
    expect(matchRule(select, r('notEmpty'), 'Resuelto')).toBe(true);
  });
  it('number', () => {
    expect(matchRule(num, r('eq', '5'), 5)).toBe(true);
    expect(matchRule(num, r('gt', '5'), 6)).toBe(true);
    expect(matchRule(num, r('lt', '5'), 6)).toBe(false);
    expect(matchRule(num, r('gte', '5'), 5)).toBe(true);
    expect(matchRule(num, r('lte', '5'), 4)).toBe(true);
    expect(matchRule(num, r('gt', '0'), '')).toBe(false); // celda vacía no cumple
  });
  it('date (ISO y dd-mm-yyyy)', () => {
    expect(matchRule(date, r('before', '2026-09-10'), '03-09-2026 12:38:02')).toBe(true);
    expect(matchRule(date, r('after', '2026-09-10'), '2026-09-03 12:38:02')).toBe(false);
    expect(matchRule(date, r('on', '2026-09-03'), '3/9/2026 8:00:00')).toBe(true);
  });
  it('reglas incompletas no filtran', () => {
    expect(matchRule(text, r('contains', ''), 'algo')).toBe(true);
    expect(matchRule(num, r('gt', '  '), 1)).toBe(true);
    expect(matchRule(text, r('opInexistente', 'x'), 'y')).toBe(true);
  });
});

describe('matchFilters', () => {
  const fields: Fields = { status: select, agent: text, fecha: date };
  const today = new Date(), iso = (k: number) => { const x = new Date(today.getFullYear(), today.getMonth(), today.getDate() + k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const rangoONulo = [r('within', '14', 'fecha'), { ...r('empty', '', 'fecha'), join: 'or' as const }];
  it('rango de fecha o fecha vacía (filtro por defecto de los tableros)', () => {
    expect(matchFilters(rangoONulo, fields, { fecha: iso(3) })).toBe(true);
    expect(matchFilters(rangoONulo, fields, { fecha: iso(-14) })).toBe(true);
    expect(matchFilters(rangoONulo, fields, { fecha: null })).toBe(true);
    expect(matchFilters(rangoONulo, fields, { fecha: iso(15) })).toBe(false);
  });
  it("'y' pesa más que 'o': A y B o C = (A y B) o C", () => {
    const f = [r('is', 'Nuevo', 'status'), r('contains', 'ana', 'agent'), { ...r('empty', '', 'fecha'), join: 'or' as const }];
    expect(matchFilters(f, fields, { status: 'Nuevo', agent: 'x', fecha: iso(0) })).toBe(false);
    expect(matchFilters(f, fields, { status: 'Otro', agent: 'x', fecha: null })).toBe(true);
    expect(matchFilters(f, fields, { status: 'Nuevo', agent: 'Ana', fecha: iso(0) })).toBe(true);
  });
  it('grupo: A y (B o C)', () => {
    const f = [r('is', 'Nuevo', 'status'), { id: 'g', join: 'and' as const, rules: [r('contains', 'ana', 'agent'), { ...r('empty', '', 'fecha'), join: 'or' as const }] }];
    expect(matchFilters(f, fields, { status: 'Nuevo', agent: 'x', fecha: null })).toBe(true);
    expect(matchFilters(f, fields, { status: 'Nuevo', agent: 'x', fecha: iso(0) })).toBe(false);
    expect(matchFilters(f, fields, { status: 'Otro', agent: 'Ana', fecha: null })).toBe(false);
    expect(matchFilters([{ id: 'g', rules: [r('contains', '', 'agent')] }], fields, {})).toBe(true); // grupo sin reglas completas no filtra
  });
  it('entre, e ignora reglas incompletas', () => {
    expect(matchFilters([r('between', '2026-09-01|2026-09-30', 'fecha')], fields, { fecha: '2026-09-30T00:00:00Z' })).toBe(true);
    expect(matchFilters([r('between', '2026-09-01|', 'fecha')], fields, { fecha: '2020-01-01' })).toBe(true);
    expect(matchFilters([], fields, {})).toBe(true);
  });
});

describe('matchSearch / railGroups', () => {
  const fields: Fields = { status: select, agent: text, fecha: date };
  it('busca en cualquier campo sin distinguir mayúsculas', () => {
    expect(matchSearch(' ANA ', fields, { agent: 'Mariana' })).toBe(true);
    expect(matchSearch('zzz', fields, { agent: 'Mariana', status: 'Nuevo' })).toBe(false);
    expect(matchSearch('', fields, {})).toBe(true);
  });
  it('select en orden de opción, fechas por día y sin valor al final', () => {
    const rows = [{ status: 'Resuelto' }, { status: '' }, { status: 'Nuevo' }, { status: 'Resuelto' }];
    expect(railGroups(select, 'status', rows).map(g => [g.key, g.count])).toEqual([['Nuevo', 1], ['Resuelto', 2], ['', 1]]);
    const fechas = [{ fecha: '2026-09-30T10:00:00' }, { fecha: '30-09-2026' }, { fecha: '2026-09-01' }];
    expect(railGroups(date, 'fecha', fechas).map(g => [g.key, g.count])).toEqual([['2026-09-01', 1], ['2026-09-30', 2]]);
  });
  it('withEmpty agrega las opciones sin registros en su orden', () => {
    const rows = [{ status: 'Resuelto' }];
    expect(railGroups(select, 'status', rows, true).map(g => [g.key, g.count])).toEqual([['Nuevo', 0], ['En curso', 0], ['Resuelto', 1]]);
  });
});

describe('compareValues / toISODate', () => {
  it('select ordena por índice de opción, desconocidos al final', () => {
    const vals = ['Resuelto', 'Otro', 'Nuevo', 'En curso'];
    expect(vals.sort((a, b) => compareValues(select, a, b))).toEqual(['Nuevo', 'En curso', 'Resuelto', 'Otro']);
  });
  it('toISODate', () => {
    expect(toISODate('03-09-2026 12:00')).toBe('2026-09-03');
    expect(toISODate('basura')).toBe('');
  });
});

describe('paginate', () => {
  const isG = (s: string) => s.startsWith('G');
  const flat = ['G1', 'a', 'b', 'c', 'G2', 'd', 'e'];
  it('corta por tamaño y repite el encabezado del grupo al continuar', () => {
    expect(paginate(flat, 0, 3, isG)).toEqual({ rows: ['G1', 'a', 'b'], index: 0, pageCount: 3 });
    expect(paginate(flat, 1, 3, isG)).toEqual({ rows: ['G1', 'c', 'G2', 'd'], index: 1, pageCount: 3 });
    expect(paginate(flat, 2, 3, isG).rows).toEqual(['G2', 'e']);
  });
  it('0 = todas; página fuera de rango se ajusta', () => {
    expect(paginate(flat, 5, 0, isG)).toEqual({ rows: flat, index: 0, pageCount: 1 });
    expect(paginate(flat, 9, 3, isG).index).toBe(2);
    expect(paginate([], 0, 25, isG)).toEqual({ rows: [], index: 0, pageCount: 1 });
  });
  it('sin grupos no agrega nada', () => {
    expect(paginate(['a', 'b', 'c'], 1, 2, isG).rows).toEqual(['c']);
  });
});

describe('fitColumns', () => {
  it('todas caben → sin barra; sin medir aún → todas', () => {
    expect(fitColumns(6 * 240 + 5 * 14, 6)).toEqual({ expanded: 6, bar: 'none' });
    expect(fitColumns(0, 6)).toEqual({ expanded: 6, bar: 'none' });
  });
  it('no caben → barra lateral con las que sobran', () => {
    expect(fitColumns(1200, 6)).toEqual({ expanded: 3, bar: 'side' }); // (1200-200)/254 = 3.9
    expect(fitColumns(600, 6)).toEqual({ expanded: 1, bar: 'side' });
  });
  it('angosto → barra arriba y al menos una columna', () => {
    expect(fitColumns(400, 6)).toEqual({ expanded: 1, bar: 'top' });
    expect(fitColumns(200, 6)).toEqual({ expanded: 1, bar: 'top' });
  });
  it('max: tope de columnas completas; el resto va a la barra aunque quepa', () => {
    expect(fitColumns(3000, 7, { max: 3 })).toEqual({ expanded: 3, bar: 'side' });
    expect(fitColumns(3000, 3, { max: 3 })).toEqual({ expanded: 3, bar: 'none' });
    expect(fitColumns(800, 7, { max: 3 })).toEqual({ expanded: 2, bar: 'side' }); // (800-200)/254 = 2.4
    expect(fitColumns(400, 7, { max: 3 })).toEqual({ expanded: 1, bar: 'top' });
    expect(fitColumns(0, 7, { max: 3 })).toEqual({ expanded: 3, bar: 'side' });
  });
});

describe('openColumns / openColumn', () => {
  const keys = ['a', 'b', 'c', 'd', 'e'];
  it('sin guardar abre las primeras hasta el límite', () => {
    expect(openColumns(keys, undefined, 3)).toEqual(['a', 'b', 'c']);
  });
  it('respeta las guardadas (también vacío = todas colapsadas) y descarta claves que ya no existen', () => {
    expect(openColumns(keys, ['d', 'x', 'a'], 3)).toEqual(['d', 'a']);
    expect(openColumns(keys, [], 3)).toEqual([]);
    expect(openColumns(keys, ['e', 'd', 'c', 'b'], 2)).toEqual(['e', 'd']); // pantalla angosta: menos columnas
  });
  it('abrir una cuarta colapsa la abierta hace más tiempo', () => {
    expect(openColumn(['c', 'b', 'a'], 'e', 3)).toEqual(['e', 'c', 'b']);
    expect(openColumn(['c', 'b'], 'b', 3)).toEqual(['b', 'c']);
  });
});

describe('withGroupOrder / moveKey', () => {
  const fields: Fields = { status: select, agent: text };
  it('reordena las opciones del select; las que faltan van al final en su orden', () => {
    const out = withGroupOrder(fields, { status: ['Resuelto', 'Nuevo'] });
    expect(out.status.options!.map(o => o.value)).toEqual(['Resuelto', 'Nuevo', 'En curso']);
    expect(railGroups(out.status, 'status', [{ status: 'Nuevo' }, { status: 'Resuelto' }]).map(g => g.key)).toEqual(['Resuelto', 'Nuevo']);
  });
  it('sin orden o en campos que no son select devuelve lo mismo', () => {
    expect(withGroupOrder(fields)).toBe(fields);
    expect(withGroupOrder(fields, { agent: ['b', 'a'] }).agent).toBe(fields.agent);
  });
  it('moveKey sube y baja sin salirse de los extremos', () => {
    expect(moveKey(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveKey(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
  });
});

describe('moveTo', () => {
  it('soltar sobre otro grupo lo deja en su lugar, subiendo o bajando', () => {
    expect(moveTo(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(moveTo(['a', 'b', 'c', 'd'], 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(['a', 'b'], 'a', 'x')).toEqual(['a', 'b']);
  });
});
