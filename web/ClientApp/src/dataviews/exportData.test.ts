import { describe, expect, it } from 'vitest';
import { crc32, toPrintHtml, toXlsx, type ExportData } from './exportData';

const data: ExportData = {
  title: 'En picking · Todos',
  fileName: 'En picking - Todos - 2024-01-01',
  columns: [
    { id: 'cliente', field: { label: 'Cliente', type: 'text' } },
    { id: 'fecha', field: { label: 'Fecha convenida', type: 'date' } },
    { id: 'monto', field: { label: 'Monto', type: 'number' } },
  ],
  rows: [
    { group: 'Hoy', count: 2 },
    { values: { cliente: 'Ferretería <Sur> & Cía', fecha: '2024-01-01T00:00:00', monto: 1500 } },
    { values: { cliente: 'Clínica Norte', fecha: null, monto: '' } },
  ],
  filters: ['Estado es «Hoy»'],
};

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('crc32', () => {
  it('valor de referencia', () => expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926));
});

describe('toXlsx', () => {
  const bytes = toXlsx(data);
  const s = text(bytes);
  it('es un zip con las partes del libro', () => {
    expect(s.startsWith('PK\u0003\u0004')).toBe(true);
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) expect(s).toContain(part);
  });
  it('fechas como número de serie, números como número y texto escapado; sin encabezados de grupo', () => {
    expect(s).toContain('<c r="B2" s="2"><v>45292</v></c>');
    expect(s).toContain('<c r="C2"><v>1500</v></c>');
    expect(s).toContain('Ferretería &lt;Sur&gt; &amp; Cía');
    expect(s).not.toContain('>Hoy<');
    expect(s).toContain('<autoFilter ref="A1:C3"/>');
  });
});

describe('toPrintHtml', () => {
  const html = toPrintHtml(data, new Date(2024, 0, 1, 10, 0));
  it('tabla con grupos, filtros y conteo', () => {
    expect(html).toContain('<title>En picking - Todos - 2024-01-01</title>');
    expect(html).toContain('2 registros');
    expect(html).toContain('<li>Estado es «Hoy»</li>');
    expect(html).toContain('<tr class="g"><td colspan="3">Hoy <span>· 2</span></td></tr>');
    expect(html).toContain('<td>01-01-2024</td>');
    expect(html).toContain('Ferretería &lt;Sur&gt; &amp; Cía');
  });
});
