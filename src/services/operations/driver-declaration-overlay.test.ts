import { beforeEach, describe, expect, it } from 'vitest';

import { withDriverDeclarations } from './driver-declaration-overlay';
import { clearProofs, deliveryProofInputSchema, recordDeliveryProof } from '@/services/deliveries/proof-store';
import { isTrackingAllowed } from '@/lib/engines/delivery-detection';
import type { ExternalOperationsProvider } from './operations-provider';
import type { Route, RouteId, WorkOrder, WorkOrderId } from '@/types/core';

const OT = 'wo-1' as WorkOrderId;
const RUTA = 'route-1' as RouteId;

const BASE: WorkOrder = {
  id: OT,
  number: 'OT-1',
  orderId: 'ord-1' as WorkOrder['orderId'],
  orderNumber: 'PED-1',
  clientId: 'cli-1' as WorkOrder['clientId'],
  clientName: 'Transportes Andes',
  locationId: 'loc-1',
  addressLine: 'Av. Siempre Viva 100',
  communeCode: '13101',
  communeName: 'Santiago',
  coordinates: { lat: -33.45, lng: -70.66 },
  vehicleId: 'veh-1' as WorkOrder['vehicleId'],
  driverId: null,
  routeId: RUTA,
  stopSequence: 1,
  scheduledDate: '2026-08-27T12:00:00.000Z',
  scheduledWindowStart: null,
  scheduledWindowEnd: null,
  estimatedArrivalAt: null,
  actualArrivalAt: null,
  actualDepartureAt: null,
  priority: 'normal',
  status: 'en_ruta',
  geofenceId: null,
  deliveryConfirmation: 'none',
  closestApproachMeters: null,
  dwellSeconds: null,
  notes: null,
  trackingToken: null,
};

const ROUTE: Route = {
  id: RUTA,
  code: 'R-1',
  name: 'Ruta norte',
  date: '2026-08-27T12:00:00.000Z',
  vehicleId: 'veh-1' as Route['vehicleId'],
  driverId: null,
  status: 'en_curso',
  authorizedCommuneCodes: ['13101'],
  stops: [
    {
      sequence: 1,
      workOrderId: OT,
      clientId: BASE.clientId,
      clientName: BASE.clientName,
      addressLine: BASE.addressLine,
      communeName: BASE.communeName,
      coordinates: BASE.coordinates,
      plannedArrivalAt: null,
      actualArrivalAt: null,
      status: 'en_ruta',
    },
  ],
  plannedPath: [],
  executedPath: [],
  plannedDistanceKm: 10,
  startedAt: null,
  completedAt: null,
};

function fakeProvider(workOrder: WorkOrder = BASE): ExternalOperationsProvider {
  return {
    info: { id: 'mock', label: 'Prueba', simulated: true, readOnly: true },
    getWorkOrders: async () => [workOrder],
    getWorkOrderById: async () => workOrder,
    getWorkOrderByNumber: async () => workOrder,
    getRoutes: async () => [ROUTE],
    getRouteById: async () => ROUTE,
    getDrivers: async () => [],
  } as unknown as ExternalOperationsProvider;
}

async function declarar(outcome: 'entregada' | 'incidencia', extra: Record<string, unknown> = {}) {
  await recordDeliveryProof(
    deliveryProofInputSchema.parse({
      outcome,
      receiverName: outcome === 'entregada' ? 'Patricia Soto' : undefined,
      incidentReason: outcome === 'incidencia' ? 'cliente_ausente' : undefined,
      declaredAt: '2026-08-27T14:05:00.000Z',
      ...extra,
    }),
    { workOrderId: OT, routeId: RUTA, driverId: null, vehicleId: null, clientCoordinates: null },
  );
}

describe('declaracion del conductor sobre la fuente operacional', () => {
  beforeEach(() => clearProofs());

  it('no altera nada mientras no hay declaracion', async () => {
    const provider = withDriverDeclarations(fakeProvider());
    expect((await provider.getWorkOrderById(OT))?.status).toBe('en_ruta');
  });

  it('cierra la parada cuando el conductor firma la entrega', async () => {
    await declarar('entregada');
    const provider = withDriverDeclarations(fakeProvider());
    const workOrder = await provider.getWorkOrderById(OT);

    expect(workOrder?.status).toBe('completada');
    expect(workOrder?.deliveryConfirmation).toBe('driver');
    expect(workOrder?.actualArrivalAt).toBe('2026-08-27T14:05:00.000Z');
  });

  it('corta el seguimiento publico en cuanto el conductor firma', async () => {
    await declarar('entregada');
    const provider = withDriverDeclarations(fakeProvider());
    const workOrder = await provider.getWorkOrderByNumber('OT-1');

    expect(workOrder && isTrackingAllowed(workOrder)).toBe(false);
  });

  it('una incidencia NO cuenta como entrega aunque el camion estuviera dentro', async () => {
    await declarar('incidencia');
    const dentro: WorkOrder = { ...BASE, status: 'en_cliente', deliveryConfirmation: 'gps' };
    const provider = withDriverDeclarations(fakeProvider(dentro));
    const workOrder = await provider.getWorkOrderById(OT);

    expect(workOrder?.status).toBe('incidencia');
    expect(workOrder?.deliveryConfirmation).toBe('gps');
    expect(workOrder?.actualArrivalAt).toBeNull();
  });

  it('no reabre una parada cancelada', async () => {
    await declarar('entregada');
    const provider = withDriverDeclarations(fakeProvider({ ...BASE, status: 'cancelada' }));
    expect((await provider.getWorkOrderById(OT))?.status).toBe('cancelada');
  });

  it('propaga la declaracion a las paradas de la ruta', async () => {
    await declarar('entregada');
    const provider = withDriverDeclarations(fakeProvider());
    const route = await provider.getRouteById(RUTA);

    expect(route?.stops[0]?.status).toBe('completada');
    expect(route?.stops[0]?.actualArrivalAt).toBe('2026-08-27T14:05:00.000Z');
  });

  it('deja pasar sin tocar los metodos que no intercepta', async () => {
    const provider = withDriverDeclarations(fakeProvider());
    expect(provider.info.id).toBe('mock');
    expect(await provider.getDrivers()).toEqual([]);
  });
});
