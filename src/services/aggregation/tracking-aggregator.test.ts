import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Position, WorkOrder } from '@/types/core';
const mocks = vi.hoisted(() => ({
  workOrder: vi.fn(),
  vehicles: vi.fn(),
  gpsVehicles: vi.fn(),
  position: vi.fn(),
  eta: vi.fn(),
}));
vi.mock('@/services/registry', () => ({
  getGpsProvider: () => ({
    info: { simulated: false },
    getVehiclePosition: mocks.position,
    getVehicles: mocks.gpsVehicles,
  }),
  getOperationsProvider: () => ({
    info: { simulated: false },
    getWorkOrderByNumber: mocks.workOrder,
    getVehicles: mocks.vehicles,
  }),
}));
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});
vi.mock('@/services/eta/eta-service', () => ({ estimateEta: mocks.eta }));
import { loadTrackingSession } from './tracking-aggregator';
const order = {
  id: 'w1',
  number: 'OT-1',
  orderNumber: 'PED-1',
  status: 'en_ruta',
  vehicleId: 'v1',
  routeId: null,
  deliveryConfirmation: 'none',
  actualArrivalAt: null,
  actualDepartureAt: null,
  dwellSeconds: null,
  coordinates: { lat: -33.45, lng: -70.66 },
  addressLine: 'Destino',
  communeName: 'Santiago',
} as WorkOrder;
const sample = (): Position => ({
  vehicleId: 'v1' as Position['vehicleId'],
  deviceId: 'd1' as Position['deviceId'],
  timestamp: new Date().toISOString(),
  lat: -33.46,
  lng: -70.67,
  speed: 24,
  heading: 90,
  ignition: 'on',
  valid: true,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workOrder.mockResolvedValue(order);
  mocks.vehicles.mockResolvedValue([]);
  mocks.gpsVehicles.mockResolvedValue([
    { id: 'v1', plate: 'RBDC59', fleetCode: 'C1' },
  ]);
  mocks.position.mockResolvedValue(sample());
  mocks.eta.mockResolvedValue({
    minutes: 15,
    arrivalAt: new Date().toISOString(),
    distanceKm: 5,
    source: 'estimated',
  });
});
describe('seguimiento publico fiable', () => {
  it('incorpora el vehiculo de 3DTracking sin exigir un duplicado local y usa su velocidad real', async () => {
    const session = await loadTrackingSession({ reference: 'OT-1' });
    expect(session?.vehicle).toMatchObject({
      speedKmh: 24,
      moving: true,
      connection: 'online',
    });
    expect(session?.vehicle?.label).not.toContain('RBDC59');
  });
  it.each(['completada', 'visita_detectada', 'cancelada'] as const)(
    'corta ubicacion y ETA cuando la orden esta %s',
    async (status) => {
      mocks.workOrder.mockResolvedValue({ ...order, status });
      const session = await loadTrackingSession({ reference: 'OT-1' });
      expect(session).toMatchObject({
        trackingAllowed: false,
        vehicle: null,
        eta: null,
        trajectory: null,
      });
      expect(mocks.position).not.toHaveBeenCalled();
      if (status === 'cancelada')
        expect(session?.statusLabel).toBe('Pedido cancelado');
    },
  );
  it.each([
    { ...sample(), timestamp: new Date(Date.now() - 5 * 60000).toISOString() },
    { ...sample(), valid: false },
    { ...sample(), lat: 0, lng: 0 },
    { ...sample(), timestamp: new Date(Date.now() + 5 * 60000).toISOString() },
  ])(
    'no publica un fix perdido, invalido o con reloj adelantado',
    async (p) => {
      mocks.position.mockResolvedValue(p);
      const session = await loadTrackingSession({ reference: 'OT-1' });
      expect(session?.vehicle?.position).toBeNull();
      expect(session?.eta).toBeNull();
      expect(mocks.eta).not.toHaveBeenCalled();
    },
  );
  it('conserva el estado del pedido si el GPS falla, sin inventar una ubicacion', async () => {
    mocks.position.mockRejectedValue(new Error('network'));
    expect(await loadTrackingSession({ reference: 'OT-1' })).toMatchObject({
      status: 'en_ruta',
      vehicle: { position: null, moving: false },
      eta: null,
    });
  });
});

it('entrega al visor la caducidad de la muestra para no publicar señal vieja durante un corte de red', async () => {
  const p = sample();
  mocks.position.mockResolvedValue(p);
  const session = await loadTrackingSession({ reference: 'OT-1' });
  expect(
    Date.parse(session!.vehicle!.freshUntil!) - Date.parse(p.timestamp),
  ).toBe(60000);
  expect(
    Date.parse(session!.vehicle!.positionExpiresAt!) - Date.parse(p.timestamp),
  ).toBe(180000);
});


it('no entrega información comercial del cliente ni documentos internos al portal', async () => {
  mocks.workOrder.mockResolvedValue({ ...order, clientName: 'Privado', clientId: 'private-client', notes: 'Saldo pendiente privado', products: [{ price: 12345 }], totalAmount: 99999 });
  const session = await loadTrackingSession({ reference: 'OT-1' });
  expect(session).not.toHaveProperty('clientName');
  expect(session).not.toHaveProperty('clientId');
  expect(session).not.toHaveProperty('products');
  expect(session).not.toHaveProperty('notes');
  expect(session).not.toHaveProperty('totalAmount');
  expect(JSON.stringify(session)).not.toContain('Privado');
});
