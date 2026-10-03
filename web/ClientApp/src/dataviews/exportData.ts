// Descarga de lo que muestra la vista (filtros, búsqueda, orden y columnas visibles): Excel (.xlsx) y PDF.
// Sin dependencias: el .xlsx es un zip sin compresión con el XML mínimo de SpreadsheetML;
// el PDF es una tabla HTML propia que se imprime desde un iframe oculto ("Guardar como PDF").
import { formatValue } from './fields';
import { toISODate } from './rules';
import type { FieldDef } from './types';

export interface ExportColumn {
  id: string;
  field: FieldDef;
}

/** Filas en el orden de la vista; group = encabezado de grupo (solo se usa en el PDF). */
export type ExportRow = { group: string; count: number } | { values: Record<string, unknown> };

export interface ExportData {
  title: string; // p. ej. "En picking · Todos"
  fileName: string; // sin extensión
  columns: ExportColumn[];
  rows: ExportRow[];
  filters: string[]; // descripción legible de filtros y búsqueda
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const leaves = (rows: ExportRow[]) => rows.filter((r): r is { values: Record<string, unknown> } => 'values' in r);

/* ── Excel ─────────────────────────────────────────────────────────────── */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip con método "stored" (sin compresión): suficiente para un xlsx y lo abre Excel sin avisos. */
export function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(8, 0x0800, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of all) { out.set(p, i); i += p.length; }
  return out;
}

const colName = (i: number): string => (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
// Fecha de Excel: días desde 1899-12-30.
const excelDate = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;
// Caracteres de control no válidos en XML.
const xml = (s: string) => esc(s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''));

/** Libro .xlsx de una hoja: encabezado en negrita, fila fija, autofiltro; fechas y números como tales. */
export function toXlsx(d: ExportData): Uint8Array {
  const rows = leaves(d.rows);
  const cell = (ref: string, field: FieldDef, v: unknown) => {
    if (v == null || v === '') return '';
    if (field.type === 'number' && Number.isFinite(Number(v))) return `<c r="${ref}"><v>${Number(v)}</v></c>`;
    const iso = field.type === 'date' ? toISODate(v) : '';
    if (iso) return `<c r="${ref}" s="2"><v>${excelDate(iso)}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  };
  const head = d.columns.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xml(c.field.label)}</t></is></c>`).join('');
  const body = rows.map((r, n) =>
    `<row r="${n + 2}">${d.columns.map((c, i) => cell(`${colName(i)}${n + 2}`, c.field, r.values[c.id])).join('')}</row>`).join('');
  // Ancho aproximado según el texto más largo (tope 60 caracteres).
  const widths = d.columns.map(c => Math.min(60, Math.max(c.field.label.length + 2, ...rows.map(r => formatValue(c.field, r.values[c.id]).length + 2), 8)));
  const last = `${colName(Math.max(d.columns.length - 1, 0))}${rows.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData><row r="1">${head}</row>${body}</sheetData>
<autoFilter ref="A1:${last}"/>
</worksheet>`;
  const sheetName = xml(d.title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Datos');
  return zip({
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$1:$${last.replace(/(\d+)$/, '$$$1')}</definedName></definedNames>
</workbook>`,
    'xl/worksheets/sheet1.xml': sheet,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    // Estilos: 0 normal · 1 encabezado (negrita, fondo gris, borde inferior) · 2 fecha dd-mm-aaaa.
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\\-mm\\-yyyy"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EDF3"/></patternFill></fill></fills>
<borders count="2"><border/><border><bottom style="thin"><color rgb="FF8A99AB"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`,
  });
}

function save(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadExcel(d: ExportData) {
  save(new Blob([toXlsx(d) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), d.fileName + '.xlsx');
}

/* ── PDF ───────────────────────────────────────────────────────────────── */

/** Documento HTML para imprimir: siempre claro, apaisado, encabezado de tabla repetido en cada hoja. */
export function toPrintHtml(d: ExportData, generated = new Date()): string {
  const n = leaves(d.rows).length;
  const head = d.columns.map(c => `<th>${esc(c.field.label)}</th>`).join('');
  const body = d.rows.map(r => 'group' in r
    ? `<tr class="g"><td colspan="${d.columns.length}">${esc(r.group || '(vacío)')} <span>· ${r.count}</span></td></tr>`
    : `<tr>${d.columns.map(c => `<td${c.field.type === 'number' ? ' class="n"' : ''}>${esc(formatValue(c.field, r.values[c.id]))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.fileName)}</title><style>
@page { size: landscape; margin: 12mm 10mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 8.5pt/1.35 Roboto, "Segoe UI", system-ui, sans-serif; color: #000; background: #fff; }
h1 { font-size: 14pt; margin: 0 0 2pt; }
.meta { color: #333; margin: 0 0 2pt; }
.filters { margin: 4pt 0 8pt; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 3pt 6pt; }
.filters li { border: 1px solid #999; border-radius: 3pt; padding: 1pt 5pt; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .03em; background: #e8edf3; border-bottom: 1.5px solid #000; }
th, td { padding: 3pt 5pt; vertical-align: top; word-break: break-word; }
td { border-bottom: 1px solid #ccc; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
tbody tr:nth-child(even):not(.g) td { background: #f5f7fa; }
tr { break-inside: avoid; }
tr.g td { font-weight: 700; background: #dde3ea; border-bottom: 1px solid #999; padding-top: 5pt; }
tr.g span { font-weight: 400; color: #333; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
<h1>${esc(d.title)}</h1>
<p class="meta">${n} ${n === 1 ? 'registro' : 'registros'} · Generado el ${esc(generated.toLocaleString('es-CL'))}</p>
${d.filters.length ? `<ul class="filters">${d.filters.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="meta">Sin filtros</p>'}
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

/** Abre el diálogo de impresión con la tabla (el usuario elige "Guardar como PDF"). */
export function printPdf(d: ExportData) {
  // Por si un navegador no dispara afterprint: el iframe de la impresión anterior se quita acá.
  document.querySelectorAll('iframe[data-dv-print]').forEach(f => f.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute('data-dv-print', '');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = toPrintHtml(d);
  frame.onload = () => {
    const w = frame.contentWindow!;
    // El título del documento es el nombre sugerido del PDF.
    w.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 100));
    w.focus();
    w.print();
  };
  document.body.appendChild(frame);
}
