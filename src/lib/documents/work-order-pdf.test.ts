import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildWorkOrderPdf, type WorkOrderDocument } from './work-order-pdf';

const data = { workOrder: { id: 'wo1', number: 'OT-PRUEBA-001', clientId: 'c1', locationId: 'l1', clientName: 'Cliente Ñuñoa',
  addressLine: 'Av. José Pedro Alessandri 1200', communeName: 'Ñuñoa', scheduledDate: '2026-10-07T12:00:00Z',
  scheduledWindowStart: null, scheduledWindowEnd: null, orderNumber: 'PED-001', status: 'en_cliente', deliveryConfirmation: 'none',
  actualArrivalAt: null, actualDepartureAt: null, notes: null },
  order: { clientId: 'c1', locationId: 'l1', lines: [{ description: 'Petróleo diésel', liters: 12000, compartment: 1 }], notes: null },
  vehicle: null, driver: null, simulated: true, generatedAt: new Date('2026-10-07T12:00:00Z') } as WorkOrderDocument;

describe('OT descargable', () => {
  it('genera un PDF A4 válido con acentos y metadatos de la OT', async () => {
    const bytes = await buildWorkOrderPdf(data);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toContain('OT-PRUEBA-001');
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  });
  it('pagina productos y observaciones largas y tolera símbolos no disponibles en la fuente', async () => {
    const bytes = await buildWorkOrderPdf({ ...data, order: { ...data.order!, lines: Array.from({ length: 80 }, (_, i) => ({ ...data.order!.lines[0]!, description: `Combustible ${i} ⛽ ${'Descripción extendida '.repeat(8)}` })), notes: 'Observaciones '.repeat(400) } });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);
  });
  it('puede descargar la OT aunque no existan productos o asignación', async () => {
    expect((await PDFDocument.load(await buildWorkOrderPdf({ ...data, order: null }))).getPageCount()).toBe(1);
  });
});
