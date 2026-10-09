import type { Position, Route, GpsEvent, AlertSeverity, WorkOrder, Client } from '@/types/core';
import type { OperationalSettings } from '@/config/operational';
import type { CreateAlertInput } from '@/services/fleet/alert-store';
import { evaluateConnectionState } from '@/lib/engines/gps-health';
import { evaluateRouteDeviation, detectStops, evaluateCommuneCompliance } from '@/lib/engines/route-compliance';
import { calculateClientActivityStatus } from '@/lib/engines/client-activity';
import { isContinuous } from '@/lib/engines/route-replay';
import { haversineMeters, isUsableCoordinate } from '@/lib/geo';
import { gpsDisplayText } from '@/lib/gps-branding';
import { COMMUNES } from '@/data/communes';

export function gpsHealthAlert(vehicleId: Position['vehicleId'], plate: string, position: Position | null, deviceId: string, settings: OperationalSettings, now: Date): CreateAlertInput | null {
  const state = evaluateConnectionState(position?.timestamp ?? null, settings.gps, now);
  if (state.state === 'online' || state.state === 'stale') return null;
  if (position && state.state === 'unknown') return null; // Reloj imposible: no inventar una perdida de señal.
  const offline = state.state === 'offline';
  const type = offline ? 'gps_offline' : 'gps_sin_posicion_reciente';
  const threshold = offline ? settings.gps.offlineSeconds : settings.gps.signalLostSeconds;
  const occurredAt = position ? new Date(Date.parse(position.timestamp) + threshold * 1000).toISOString() : now.toISOString();
  return { id: `live:gps:${vehicleId}:${deviceId}:${type}:${position?.timestamp ?? 'no-fix'}:${threshold}`,
    type, category: 'gps', severity: offline ? 'critical' : 'warning',
    title: `${plate}: ${position ? 'sin GPS reciente' : 'sin ubicación GPS'}`,
    description: position ? `No hay una posición reciente de ${plate}. Último registro GPS: ${position.timestamp}.`
      : `Todavía no se ha recibido una ubicación válida del equipo vinculado a ${plate}.`,
    timestamp: occurredAt, vehicleId, vehiclePlate: plate, position: null,
    metadata: { lastPositionAt: position?.timestamp ?? '', deviceId }, };
}

/** Los eventos deben ser expresamente reportados por el equipo, nunca deducidos de un accesorio ausente. */
export const HARDWARE_EVENT_LABEL: Record<GpsEvent['type'], { label: string; severity: AlertSeverity }> = {
  ignition_on: { label: 'Encendido reportado', severity: 'info' }, ignition_off: { label: 'Apagado reportado', severity: 'info' },
  geofence_enter: { label: 'Entrada a geocerca reportada', severity: 'info' }, geofence_exit: { label: 'Salida de geocerca reportada', severity: 'info' },
  overspeed: { label: 'Exceso de velocidad reportado', severity: 'warning' }, harsh_braking: { label: 'Frenado brusco reportado', severity: 'warning' },
  harsh_acceleration: { label: 'Aceleración brusca reportada', severity: 'warning' }, idle_start: { label: 'Ralentí reportado', severity: 'info' },
  idle_end: { label: 'Fin de ralentí reportado', severity: 'info' }, device_online: { label: 'Conexión del equipo reportada', severity: 'info' },
  device_offline: { label: 'Desconexión del equipo reportada', severity: 'warning' }, power_cut: { label: 'Alerta de alimentación externa', severity: 'critical' },
  battery_low: { label: 'Alerta de batería baja', severity: 'warning' }, jamming: { label: 'Interferencia reportada', severity: 'critical' },
  towing: { label: 'Remolque reportado', severity: 'critical' }, crash: { label: 'Colisión reportada', severity: 'critical' }, sos: { label: 'SOS reportado', severity: 'critical' },
};
export function hardwareAlert(event: GpsEvent, plate: string, now: Date): CreateAlertInput | null {
  const time = Date.parse(event.timestamp);
  if (!Number.isFinite(time) || time > now.getTime() + 60_000 || now.getTime() - time > 15 * 60_000) return null;
  const style = HARDWARE_EVENT_LABEL[event.type]; if (!style) return null;
  return { id: `live:hardware:${event.deviceId}:${event.id}:${event.timestamp}`, type: 'gps_evento_equipo', category: 'gps',
    severity: style.severity, title: `${plate}: ${style.label}`, description: gpsDisplayText(event.detail) || `${style.label} por el equipo GPS.`,
    timestamp: event.timestamp, vehicleId: event.vehicleId, vehiclePlate: plate, position: event.position ?? null,
    metadata: { eventType: event.type, deviceId: event.deviceId } };
}

/** Solo la cola continua de muestras fiables; los saltos cortan la evidencia. */
export function reliableHistoryTail(history: Position[]): Position[] {
  const tail: Position[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const sample = history[i]!;
    if (!sample.valid || !isUsableCoordinate(sample) || sample.motionEvidence === 'uncertain' || sample.speedKnown === false) break;
    if (tail.length && !isContinuous(sample, tail[0]!)) break;
    tail.unshift(sample);
  }
  return tail;
}
export function routeAlerts(route: Route, history: Position[], plate: string, settings: OperationalSettings, now: Date): CreateAlertInput[] {
  const samples = reliableHistoryTail(history); const last = samples.at(-1);
  if (!route.vehicleId || route.status !== 'en_curso' || !last || samples.length < 3 ||
      now.getTime() - Date.parse(last.timestamp) > settings.gps.staleSeconds * 1000 ||
      Date.parse(last.timestamp) > now.getTime() + 60_000) return [];
  const alerts: CreateAlertInput[] = [];
  const common = { category: 'ruta' as const, severity: 'warning' as const, vehicleId: route.vehicleId, vehiclePlate: plate, position: { lat: last.lat, lng: last.lng }, metadata: { routeId: route.id } };
  const deviation = evaluateRouteDeviation({ positions: samples, plannedPath: route.plannedPath, settings: settings.route });
  if (deviation.deviationConfirmed && deviation.deviationStartedAt) alerts.push({ ...common,
    id: `live:route:deviation:${route.id}:${deviation.deviationStartedAt}`, type: 'ruta_desvio', title: `${plate}: desvío de ruta`,
    description: `El GPS permanece a ${deviation.distanceMeters} m del corredor programado de ${route.code}.`, timestamp: last.timestamp });
  const commune = evaluateCommuneCompliance({ positions: samples, communes: [...COMMUNES], authorizedCommuneCodes: route.authorizedCommuneCodes,
    toleranceSeconds: settings.route.outOfCommuneToleranceSeconds });
  if (route.authorizedCommuneCodes.length && commune.violationConfirmed && commune.currentCommune) alerts.push({ ...common,
    id: `live:route:commune:${route.id}:${commune.currentCommune.code}`, type: 'ruta_fuera_de_comuna', title: `${plate}: fuera de la zona programada`,
    description: `Ubicación GPS en ${commune.currentCommune.name}, fuera de las comunas de ${route.code}.`, timestamp: last.timestamp });
  const stop = detectStops({ positions: samples, movingSpeedThresholdKmh: settings.gps.movingSpeedThresholdKmh,
    prolongedStopSeconds: settings.route.prolongedStopSeconds }).at(-1);
  if (stop?.prolonged && stop.endedAt === null) {
    const cluster = samples.filter(p => Date.parse(p.timestamp) >= Date.parse(stop.startedAt));
    if (cluster.every(p => haversineMeters(cluster[0]!, p) <= 15)) alerts.push({ ...common,
      id: `live:route:stop:${route.id}:${stop.startedAt}`, type: 'ruta_detencion_prolongada', title: `${plate}: detención prolongada según GPS`,
      description: `Se mantienen registros de detención durante ${Math.round(stop.durationSeconds / 60)} minutos en ${route.code}.`, timestamp: last.timestamp });
  }
  const next = route.stops.find(stop => !['completada', 'visita_detectada', 'cancelada', 'incidencia'].includes(stop.status));
  if (next?.plannedArrivalAt && now.getTime() - Date.parse(next.plannedArrivalAt) > 15 * 60_000) alerts.push({ ...common,
    id: `live:route:late:${route.id}:${next.workOrderId}:${next.plannedArrivalAt}`, type: 'ruta_atrasada', title: `${plate}: próxima parada atrasada`,
    description: `La próxima parada de ${route.code} supera en más de 15 minutos la llegada programada.`, timestamp: new Date(Date.parse(next.plannedArrivalAt) + 15 * 60_000).toISOString() });
  return alerts;
}

export function workOrderAlerts(order: WorkOrder, now: Date): CreateAlertInput[] {
  if (['completada', 'visita_detectada', 'cancelada', 'incidencia'].includes(order.status)) return [];
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' });
  if (!Number.isFinite(Date.parse(order.scheduledDate)) || (/^\d{4}-\d{2}-\d{2}$/.test(order.scheduledDate) ? order.scheduledDate : day.format(new Date(order.scheduledDate))) !== day.format(now)) return [];
  const common = { category: 'operacion' as const, severity: 'warning' as const, vehicleId: order.vehicleId,
    clientId: order.clientId, clientName: order.clientName, workOrderId: order.id, workOrderNumber: order.number, position: order.coordinates };
  const result: CreateAlertInput[] = [];
  if (!order.vehicleId) result.push({ ...common, id: `live:order:unassigned:${order.id}`, type: 'ot_sin_camion', title: `${order.number}: sin vehículo asignado`, description: 'La orden de hoy todavía no tiene vehículo asignado.', timestamp: order.scheduledDate });
  if (!order.coordinates || !isUsableCoordinate(order.coordinates)) result.push({ ...common, position: null,
    id: `live:order:coordinates:${order.id}`, type: order.coordinates ? 'direccion_invalida' : 'pedido_sin_coordenadas', title: `${order.number}: ubicación por corregir`,
    description: 'El domicilio de entrega no tiene coordenadas válidas.', timestamp: order.scheduledDate });
  if (order.scheduledWindowEnd && now.getTime() - Date.parse(order.scheduledWindowEnd) > 15 * 60_000 && !order.actualArrivalAt) result.push({ ...common,
    id: `live:order:late:${order.id}:${order.scheduledWindowEnd}`, type: 'ot_atrasada', title: `${order.number}: entrega atrasada`,
    description: 'La ventana programada terminó hace más de 15 minutos y no hay llegada registrada.', timestamp: new Date(Date.parse(order.scheduledWindowEnd) + 15 * 60_000).toISOString() });
  return result;
}

export function clientActivityAlert(client: Client, settings: OperationalSettings, now: Date): CreateAlertInput | null {
  if (!client.active) return null;
  const state = calculateClientActivityStatus({ lastPurchaseAt: client.lastPurchaseAt, lastVisitAt: client.lastVisitAt, thresholds: settings.clients, now });
  if (state.status === 'active' || state.effectiveDays === null) return null; // Sin historial no afirmar una transicion comercial.
  const reference = state.basis === 'visit' ? client.lastVisitAt : client.lastPurchaseAt;
  if (!reference || !Number.isFinite(Date.parse(reference)) || Date.parse(reference) > now.getTime()) return null;
  const dormant = state.status === 'dormant';
  const deeplyDormant = state.effectiveDays > settings.clients.warningMaxDays * 2;
  const threshold = deeplyDormant ? settings.clients.warningMaxDays * 2 : dormant ? settings.clients.warningMaxDays : settings.clients.activeMaxDays;
  return { id: `live:client:activity:${client.id}:${threshold}:${reference}`, type: deeplyDormant ? 'cliente_dormido' : dormant ? 'cliente_pasa_rojo' : 'cliente_pasa_amarillo',
    category: 'cliente', severity: 'warning', title: `${client.tradeName}: ${dormant ? 'sin actividad reciente' : 'actividad en observación'}`,
    description: `Sin actividad comercial registrada durante ${state.effectiveDays} días según los umbrales configurados.`,
    timestamp: new Date(Date.parse(reference) + (threshold + 1) * 86_400_000).toISOString(), clientId: client.id, clientName: client.tradeName };
}
