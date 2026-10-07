import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Order, Position, Vehicle, WorkOrder } from '@/types/core';
import type { FleetContext } from './fleet-aggregator';
import { loadActiveDeliveries } from './active-delivery-aggregator';
const sources = vi.hoisted(() => ({ history: vi.fn(), order: vi.fn() }));
vi.mock('@/services/registry', () => ({ getGpsProvider: () => ({ getPositionHistory: sources.history }), getOperationsProvider: () => ({ getOrderById: sources.order }) }));
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});
const now = new Date('2026-10-07T12:02:00Z');
const current = { vehicleId: 'v1', deviceId: 'd1', lat: -33.45, lng: -70.66, timestamp: now.toISOString(), valid: true, speed: 0, heading: 0, ignition: 'on' } as Position;
const workOrder = { id: 'wo1', number: 'OT-001', orderId: 'o1', clientId: 'c1', locationId: 'l1', vehicleId: 'v1', status: 'en_ruta', coordinates: current,
  clientName: 'Cliente', addressLine: 'Dirección', communeName: 'Comuna', geofenceId: null, actualArrivalAt: null, actualDepartureAt: null } as unknown as WorkOrder;
const order = { id: 'o1', clientId: 'c1', locationId: 'l1', lines: [{ description: 'Diésel', liters: 1000 }, { description: 'Gasolina 95', liters: 500 }] } as Order;
const context = (): FleetContext => ({ vehicles: [{ id: 'v1', plate: 'RBDC59' } as Vehicle], positions: new Map([['v1', current]]), devices: new Map(),
  workOrders: [workOrder], routes: [], geofences: [], alerts: [] });
beforeEach(() => {
  sources.history.mockReset().mockResolvedValue([0, 30, 60, 90, 120].map((s) => ({ ...current, timestamp: new Date(now.getTime() - (120 - s) * 1000).toISOString() })));
  sources.order.mockReset().mockResolvedValue(order);
});
describe('composición de entrega activa', () => {
  it('limita las lecturas simultáneas aun cuando hay varias entregas en curso', async () => {
    let active = 0, max = 0;
    sources.history.mockImplementation(async ({ vehicleId }: { vehicleId: Position['vehicleId'] }) => {
      active++; max = Math.max(max, active); await Promise.resolve(); active--;
      return [0, 30, 60, 90, 120].map((s) => ({ ...current, vehicleId, timestamp: new Date(now.getTime() - (120 - s) * 1000).toISOString() }));
    });
    const c = context();
    c.vehicles = Array.from({ length: 8 }, (_, i) => ({ ...c.vehicles[0]!, id: `v${i}` as Vehicle['id'] }));
    c.positions = new Map(c.vehicles.map((v) => [v.id, { ...current, vehicleId: v.id }]));
    c.workOrders = c.vehicles.map((v, i) => ({ ...workOrder, id: `wo${i}` as WorkOrder['id'], vehicleId: v.id }));
    expect(await loadActiveDeliveries(c, [], now)).toHaveLength(8); expect(max).toBeLessThanOrEqual(4);
  });
  it('asocia litros por producto y suma solamente la OT del cliente y domicilio correctos', async () => {
    const cards = await loadActiveDeliveries(context(), [], now);
    expect(cards[0]).toMatchObject({ workOrderId: 'wo1', clientId: 'c1', vehiclePlate: 'RBDC59', totalLiters: 1500,
      lines: [{ productName: 'Diésel', liters: 1000 }, { productName: 'Gasolina 95', liters: 500 }] });
    expect(sources.order).toHaveBeenCalledWith('o1');
  });
  it('no publica cantidades de otro cliente, otro domicilio o un detalle incompleto', async () => {
    for (const candidate of [{ ...order, clientId: 'c2' }, { ...order, locationId: 'l2' }, { ...order, lines: [{ ...order.lines[0]!, liters: NaN }] }]) {
      sources.order.mockResolvedValue(candidate);
      const cards = await loadActiveDeliveries(context(), [], now);
      expect(cards[0]?.lines).toBeNull(); expect(cards[0]?.totalLiters).toBeNull();
    }
  });
  it('no consulta productos ni historial cuando el camión está fuera del cliente', async () => {
    const c = context(); c.positions.set('v1', { ...current, lng: -70.65 });
    expect(await loadActiveDeliveries(c, [], now)).toEqual([]);
    expect(sources.history).not.toHaveBeenCalled(); expect(sources.order).not.toHaveBeenCalled();
  });
  it('reutiliza el historial de la ficha y mantiene la tarjeta si el detalle comercial falla', async () => {
    const history = await sources.history(); sources.history.mockClear(); sources.order.mockRejectedValue(new Error('Fuente caída'));
    const cards = await loadActiveDeliveries(context(), [], now, new Map([['v1', history]]));
    expect(sources.history).not.toHaveBeenCalled(); expect(cards[0]?.totalLiters).toBeNull();
  });
});
