import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { GET } from './route';
const sources = vi.hoisted(() => ({ guard: vi.fn(), workOrder: vi.fn(), order: vi.fn() }));
vi.mock('@/lib/api', async () => ({ ...(await vi.importActual('@/lib/api')), guardApi: sources.guard }));
vi.mock('@/services/registry', () => ({ getOperationsProvider: () => ({ info: { simulated: true }, getWorkOrderById: sources.workOrder,
  getOrderById: sources.order, getVehicles: async () => [], getDrivers: async () => [] }) }));
const workOrder = { id: 'wo1', number: 'OT-001', clientId: 'c1', locationId: 'l1', clientName: 'Cliente', addressLine: 'Dirección', communeName: 'Ñuñoa',
  scheduledDate: '2026-10-07T12:00:00Z', orderId: 'o1', orderNumber: 'PED-001', status: 'en_cliente', deliveryConfirmation: 'none',
  actualArrivalAt: null, actualDepartureAt: null, notes: null };
const request = () => GET(new Request('http://localhost/api/ordenes/wo1/documento'), { params: Promise.resolve({ workOrderId: 'wo1' }) });
beforeEach(() => { sources.guard.mockReset().mockResolvedValue(null); sources.workOrder.mockReset().mockResolvedValue(workOrder); sources.order.mockReset().mockResolvedValue(null); });
describe('descarga segura de OT', () => {
  it('exige ordenes.ver y no lee documentos si no hay autorización', async () => {
    sources.guard.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await request()).status).toBe(403);
    expect(sources.guard).toHaveBeenCalledWith('ordenes.ver'); expect(sources.workOrder).not.toHaveBeenCalled();
  });
  it('descarga un PDF válido, privado y con nombre seguro', async () => {
    sources.workOrder.mockResolvedValue({ ...workOrder, number: 'OT-001"\r\nX-Test: bad' });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Disposition')).not.toContain('\r\n');
    expect((await PDFDocument.load(await response.arrayBuffer())).getPageCount()).toBe(1);
  });
  it('responde 404 si no existe y permite reintentar cuando la fuente falla', async () => {
    sources.workOrder.mockResolvedValue(null); expect((await request()).status).toBe(404);
    sources.workOrder.mockRejectedValue(new Error('Sin conexión')); expect((await request()).status).toBe(503);
  });
});
