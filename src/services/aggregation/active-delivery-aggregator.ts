import 'server-only';
import { getOperationalSettings } from '@/services/settings/settings-store';
import { getGpsProvider, getOperationsProvider } from '@/services/registry';
import { deliveryCandidates, findActiveDelivery } from '@/lib/engines/active-delivery';
import type { FleetContext } from './fleet-aggregator';
import type { ActiveDelivery } from '@/types/views';
import type { Driver, Position } from '@/types/core';

export async function loadActiveDeliveries(context: FleetContext, drivers: Driver[], now: Date, knownHistory?: Map<string, Position[]>): Promise<ActiveDelivery[]> {
  const settings = getOperationalSettings();
  const operations = getOperationsProvider();
  const eligible = context.vehicles.filter((vehicle) => {
    const position = context.positions.get(vehicle.id);
    return position && deliveryCandidates(position, context.workOrders, context.geofences, settings).length > 0;
  });
  const resolveDelivery = async (vehicle: FleetContext['vehicles'][number]): Promise<ActiveDelivery | null> => {
    const position = context.positions.get(vehicle.id)!;
    const history = knownHistory?.get(vehicle.id) ?? await getGpsProvider().getPositionHistory({ vehicleId: vehicle.id,
      from: new Date(now.getTime() - 8 * 3600000).toISOString(), to: now.toISOString(), limit: 20000 }).catch(() => []);
    const visit = findActiveDelivery({ position, history, workOrders: context.workOrders, geofences: context.geofences, settings, now });
    if (!visit) return null;
    const { workOrder, geofence } = visit;
    const order = await operations.getOrderById(workOrder.orderId).catch(() => null);
    // An unrelated/missing order cannot provide the fuel quantities for this client.
    const lines = order && order.clientId === workOrder.clientId && order.locationId === workOrder.locationId &&
      order.lines.every((line) => Number.isFinite(line.liters) && line.liters >= 0)
      ? order.lines.map((line) => ({ productName: line.description, liters: line.liters })) : null;
    const anchor = workOrder.coordinates ?? (geofence.geometry.shape === 'circle' ? geofence.geometry.center : position);
    return { workOrderId: workOrder.id, workOrderNumber: workOrder.number, clientId: workOrder.clientId,
      clientName: workOrder.clientName, addressLine: workOrder.addressLine, communeName: workOrder.communeName,
      vehicleId: vehicle.id, vehiclePlate: vehicle.plate, driverName: drivers.find((d) => d.id === workOrder.driverId)?.fullName ?? null,
      lat: anchor.lat, lng: anchor.lng, geofence, enteredAt: visit.enteredAt, stoppedAt: visit.stoppedAt,
      observedAt: visit.observedAt, arrivalObserved: visit.arrivalObserved, lines,
      totalLiters: lines?.length ? lines.reduce((sum, line) => sum + line.liters, 0) : null,
      workOrderStatus: workOrder.status, staleSeconds: settings.gps.staleSeconds, movingSpeedThresholdKmh: settings.gps.movingSpeedThresholdKmh };
  };
  const results: (ActiveDelivery | null)[] = Array.from({ length: eligible.length }, () => null);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, eligible.length) }, async () => {
    while (cursor < eligible.length) {
      const index = cursor++;
      results[index] = await resolveDelivery(eligible[index]!);
    }
  }));
  return results.filter((delivery): delivery is ActiveDelivery => delivery !== null);
}
