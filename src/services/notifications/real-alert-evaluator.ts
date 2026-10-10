import 'server-only';
import { getGpsProvider, getOperationsProvider } from '@/services/registry';
import { getOperationalSettings } from '@/services/settings/settings-store';
import { createAlert, listAlerts, updateAlertState } from '@/services/fleet/alert-store';
import { gpsHealthAlert, hardwareAlert, routeAlerts, workOrderAlerts, clientActivityAlert } from './real-alert-rules';
import { normalizeGpsHistory } from '@/lib/gps-history';
import { asAlertId } from '@/types/core';
import { gpsCommunication } from '@/lib/engines/gps-communication';

let lastEventsAt: number | null = null;
/** Evaluacion independiente del navegador. Los datos ausentes no se sustituyen por demostracion. */
export async function evaluateRealAlerts(): Promise<void> {
  const gps = getGpsProvider(); if (gps.info.simulated || gps.info.id === 'unavailable') return;
  const now = new Date(); const operations = getOperationsProvider(); const settings = getOperationalSettings();
  const [vehicles, positions, devices] = await Promise.all([gps.getVehicles(), gps.getAllCurrentPositions(), gps.getDeviceStatus()]);
  const open = await listAlerts({ states: ['nueva', 'revisada'], limit: 500 });
  const plate = new Map(vehicles.map(v => [v.id, v.plate]));
  for (const vehicle of vehicles) {
    if (!vehicle.active || !vehicle.device) continue;
    const position = positions.find(p => p.vehicleId === vehicle.id) ?? null;
    const device = devices.find(d => d.vehicleId === vehicle.id) ?? null;
    const communication = gpsCommunication(device, position, settings.gps, now);
    // Una consulta fallida no demuestra que el equipo se haya desconectado.
    if (communication.state !== 'online' && communication.state !== 'standby' && gps.getAvailabilityWarnings?.().length) continue;
    const alert = gpsHealthAlert(vehicle.id, vehicle.plate, position, vehicle.device.id, settings, now, device);
    if (alert && !open.some(a => a.vehicleId === vehicle.id && a.type === alert.type && a.id.startsWith('live:gps:'))) await createAlert(alert);
    if (alert?.type === 'gps_offline') for (const previous of open.filter(a => a.vehicleId === vehicle.id && a.type === 'gps_sin_posicion_reciente' && a.id.startsWith('live:gps:'))) await updateAlertState(asAlertId(previous.id), 'resuelta');
    const fresh = position && Number.isFinite(Date.parse(position.timestamp)) &&
      now.getTime() - Date.parse(position.timestamp) <= settings.gps.staleSeconds * 1000 &&
      Date.parse(position.timestamp) <= now.getTime() + 60_000;
    const staleAlerts = open.filter(a => a.vehicleId === vehicle.id && a.id.startsWith('live:gps:'));
    if ((fresh || communication.state === 'online' || communication.state === 'standby') && staleAlerts.length) {
      for (const stale of staleAlerts) await updateAlertState(asAlertId(stale.id), 'resuelta');
      if (communication.state === 'standby') continue;
      const at = fresh ? position!.timestamp : communication.lastCommunicationAt!;
      await createAlert({ id: `live:recovery:${vehicle.device.id}:${at}`, type: 'gps_senal_recuperada', category: 'gps', severity: 'info',
        title: `${vehicle.plate}: ${fresh ? 'ubicación GPS disponible' : 'equipo conectado'}`,
        description: fresh ? 'Se recibió nuevamente una posición reciente del GPS.' : 'Se confirmó una comunicación reciente del equipo GPS.',
        timestamp: at, vehicleId: vehicle.id, vehiclePlate: vehicle.plate,
        position: fresh ? { lat: position!.lat, lng: position!.lng } : null });
    }
  }
  const [eventsResult, routesResult, ordersResult, clientsResult] = await Promise.allSettled([
    gps.getVehicleEvents({ from: new Date((lastEventsAt ?? now.getTime() - 120_000) - 60_000).toISOString(), to: now.toISOString(), limit: 1000 }),
    operations.getRoutes({ limit: 100 }), operations.getWorkOrders({ limit: 500 }), operations.getClients(),
  ]);
  if (eventsResult.status === 'fulfilled') {
    for (const event of eventsResult.value) {
      const vehiclePlate = plate.get(event.vehicleId); if (!vehiclePlate) continue;
      const alert = hardwareAlert(event, vehiclePlate, now); if (alert) await createAlert(alert);
    }
    lastEventsAt = now.getTime();
  }
  if (routesResult.status === 'fulfilled') {
    for (const route of routesResult.value.filter(r => r.status === 'en_curso' && r.vehicleId)) {
      const vehiclePlate = plate.get(route.vehicleId!); if (!vehiclePlate) continue;
      try {
        const history = normalizeGpsHistory(await gps.getPositionHistory({ vehicleId: route.vehicleId!, from: new Date(now.getTime() - 3_600_000).toISOString(), to: now.toISOString(), limit: 3000 }));
        for (const alert of routeAlerts(route, history, vehiclePlate, settings, now)) {
          if (!open.some(a => a.type === alert.type && a.metadata?.routeId === route.id)) await createAlert(alert);
        }
      } catch { /* Sin historial fiable, no afirmar desvio ni detencion. */ }
    }
  }
  if (ordersResult.status === 'fulfilled') for (const order of ordersResult.value) for (const alert of workOrderAlerts(order, now)) await createAlert(alert);
  if (clientsResult.status === 'fulfilled') for (const client of clientsResult.value) {
    const alert = clientActivityAlert(client, settings, now); if (alert) await createAlert(alert);
  }
}
