import 'server-only';

import { getOperationalSettings } from '@/services/settings/settings-store';
import { getCommuneName } from '@/data/communes';
import { deriveVehicleStatus, evaluateConnectionState } from '@/lib/engines/gps-health';
import { detectStops, evaluateRouteProgress, resolveCommune } from '@/lib/engines/route-compliance';
import { COMMUNES } from '@/data/communes';
import { haversineMeters, isUsableCoordinate, projectOnPolyline } from '@/lib/geo';
import { nearbyGeofences, resolveVehicleActivity } from '@/lib/engines/vehicle-activity';
import { estimateEta } from '@/services/eta/eta-service';
import { getGpsProvider, getOperationsProvider } from '@/services/registry';
import type {
  Alert,
  DeviceStatus,
  Geofence,
  Position,
  Route,
  Vehicle,
  VehicleId,
  VehicleSnapshot,
  WorkOrder,
} from '@/types/core';
import type { RouteGeometry, RouteSummary, TimelineEntry, VehicleDetail } from '@/types/views';

/**
 * Composicion de la vista de flota.
 *
 * Une telemetria (GpsProvider) con operacion (ExternalOperationsProvider) y
 * aplica los motores de reglas. Los componentes reciben el resultado ya
 * resuelto: no consultan proveedores ni recalculan estados.
 */

const HISTORY_WINDOW_MS = 8 * 3_600_000;

export interface FleetContext {
  vehicles: Vehicle[];
  positions: Map<string, Position>;
  devices: Map<string, DeviceStatus>;
  routes: Route[];
  workOrders: WorkOrder[];
  alerts: Alert[];
  geofences: Geofence[];
}

/**
 * Une el parque del ERP con el que conoce la telemetria.
 *
 * El ERP manda: patente, planta, capacidad del estanque y compartimentos son
 * datos comerciales que el GPS no tiene. Pero un camion que reporta posicion
 * y NO esta en el ERP tiene que verse igual, porque existe y esta circulando.
 *
 * Sin esto, conectar un proveedor GPS real antes que la base de Fenice dejaba
 * el mapa vacio: llegaban posiciones de vehiculos que ningun listado incluia
 * y no habia a que asociarlas.
 */
export function mergeFleet(erpVehicles: Vehicle[], gpsVehicles: Vehicle[]): Vehicle[] {
  const porId = new Map(erpVehicles.map((v) => [String(v.id), v]));

  for (const desdeGps of gpsVehicles) {
    const id = String(desdeGps.id);
    if (porId.has(id)) continue;

    // Tambien puede estar en el ERP con otro identificador pero el mismo
    // equipo instalado: el IMEI es lo que de verdad une ambos mundos.
    const imei = desdeGps.device?.imei;
    const yaConocido =
      imei !== undefined && erpVehicles.some((v) => v.device?.imei === imei);
    if (yaConocido) continue;

    porId.set(id, desdeGps);
  }

  return [...porId.values()];
}

export async function loadFleetContext(): Promise<FleetContext> {
  const gps = getGpsProvider();
  const operations = getOperationsProvider();
  const today = new Date();

  const [erpVehicles, gpsVehicles, positions, devices, routes, workOrders, alerts, geofences] =
    await Promise.all([
      operations.getVehicles(),
      // La fuente de telemetria tambien conoce el parque. Se pide siempre
      // porque es lo que permite operar antes de conectar el ERP.
      gps.getVehicles().catch(() => [] as Vehicle[]),
      gps.getAllCurrentPositions(),
      gps.getDeviceStatus(),
      operations.getRoutes({ date: today.toISOString() }),
      operations.getWorkOrders({ date: today.toISOString() }),
      operations.getAlerts({ states: ['nueva', 'revisada'] }),
      operations.getGeofences(),
    ]);

  return {
    vehicles: mergeFleet(erpVehicles, gpsVehicles),
    positions: new Map(positions.map((p) => [p.vehicleId, p])),
    devices: new Map(devices.map((d) => [d.vehicleId, d])),
    routes,
    workOrders,
    alerts,
    geofences,
  };
}

/** Construye la instantanea de un vehiculo: estado, telemetria y asignacion. */
export function buildVehicleSnapshot(
  vehicle: Vehicle,
  context: FleetContext,
  driverName: Map<string, { id: string; fullName: string }>,
  now: Date = new Date(),
): VehicleSnapshot {
  const settings = getOperationalSettings();
  const position = context.positions.get(vehicle.id) ?? null;
  const device = context.devices.get(vehicle.id) ?? null;

  const connection = device
    ? evaluateConnectionState(device.lastPositionAt, settings.gps, now).state
    : 'unknown';

  const route = context.routes.find((r) => r.vehicleId === vehicle.id) ?? null;

  const activeWorkOrder =
    context.workOrders.find(
      (w) => w.vehicleId === vehicle.id && (w.status === 'en_cliente' || w.status === 'proxima'),
    ) ?? null;

  // Solo alertas accionables: las informativas (una entrega detectada, por
  // ejemplo) son buenas noticias y no deben marcar al vehiculo como problema.
  const openAlertCount = context.alerts.filter(
    (a) => a.vehicleId === vehicle.id && a.state !== 'resuelta' && a.severity !== 'info',
  ).length;

  const driver = vehicle.driverId ? (driverName.get(vehicle.driverId) ?? null) : null;

  // --- Estado de actividad para el marcador del mapa -----------------------
  const vehicleAlerts = context.alerts.filter(
    (a) => a.vehicleId === vehicle.id && a.state !== 'resuelta',
  );

  const deviationMeters =
    position && route && route.plannedPath.length >= 2
      ? (projectOnPolyline({ lat: position.lat, lng: position.lng }, route.plannedPath)
          ?.distanceMeters ?? null)
      : null;

  const activity = resolveVehicleActivity({
    operationalStatus: deriveVehicleStatus({
      position,
      connection,
      gps: settings.gps,
      hasActiveAssignment: route !== null,
    }),
    position,
    geofences: position
      ? nearbyGeofences(context.geofences, { lat: position.lat, lng: position.lng })
      : [],
    deviationMeters,
    alerts: vehicleAlerts,
    settings,
  });

  return {
    vehicle,
    driver: driver
      ? ({
          id: driver.id,
          fullName: driver.fullName,
          documentId: '',
          phone: '',
          licenseClass: '',
          licenseExpiresAt: '',
          active: true,
        } as VehicleSnapshot['driver'])
      : null,
    position,
    status: deriveVehicleStatus({
      position,
      connection,
      gps: settings.gps,
      hasActiveAssignment: route !== null,
    }),
    device: device
      ? { ...device, connection, secondsSinceLastPosition: device.secondsSinceLastPosition }
      : null,
    activeWorkOrderId: activeWorkOrder?.id ?? null,
    activeRouteId: route?.id ?? null,
    openAlertCount,
    activityStatus: activity.status,
    insideGeofenceId: activity.insideGeofence?.id ?? null,
    insideGeofenceName: activity.insideGeofence?.name ?? null,
    deviationMeters: activity.deviationMeters === null ? null : Math.round(activity.deviationMeters),
  };
}

export async function loadFleetSnapshots(): Promise<VehicleSnapshot[]> {
  const operations = getOperationsProvider();
  const [context, drivers] = await Promise.all([loadFleetContext(), operations.getDrivers()]);
  const driverIndex = new Map(drivers.map((d) => [d.id as string, { id: d.id as string, fullName: d.fullName }]));
  const now = new Date();

  return context.vehicles.map((vehicle) => {
    const snapshot = buildVehicleSnapshot(vehicle, context, driverIndex, now);
    const full = drivers.find((d) => d.id === vehicle.driverId) ?? null;
    return { ...snapshot, driver: full };
  });
}

/** Resumen de rutas activas para el dashboard. */
export function buildRouteSummaries(context: FleetContext, drivers: { id: string; fullName: string }[]): RouteSummary[] {
  const driverIndex = new Map(drivers.map((d) => [d.id, d.fullName]));

  return context.routes.map((route) => {
    const vehicle = route.vehicleId
      ? (context.vehicles.find((v) => v.id === route.vehicleId) ?? null)
      : null;
    const position = route.vehicleId ? (context.positions.get(route.vehicleId) ?? null) : null;

    const progress = evaluateRouteProgress(
      route,
      position ? { lat: position.lat, lng: position.lng } : null,
    );

    return {
      routeId: route.id,
      code: route.code,
      name: route.name,
      vehicleId: route.vehicleId,
      vehiclePlate: vehicle?.plate ?? null,
      driverName: route.driverId ? (driverIndex.get(route.driverId) ?? null) : null,
      status: route.status,
      totalStops: progress.totalStops,
      completedStops: progress.completedStops,
      nextStopName: progress.nextStop?.clientName ?? null,
      nextStopEta: progress.nextStop?.plannedArrivalAt ?? null,
      plannedDistanceKm: route.plannedDistanceKm,
      progressRatio: progress.completionRatio,
    };
  });
}

export function toRouteGeometry(route: Route, vehiclePlate: string | null): RouteGeometry {
  return {
    routeId: route.id,
    code: route.code,
    name: route.name,
    vehicleId: route.vehicleId,
    vehiclePlate,
    status: route.status,
    plannedPath: route.plannedPath,
    executedPath: route.executedPath,
    stops: route.stops
      .filter((s) => isUsableCoordinate(s.coordinates))
      .map((s) => ({
        sequence: s.sequence,
        workOrderId: s.workOrderId,
        clientName: s.clientName,
        addressLine: s.addressLine,
        lat: s.coordinates!.lat,
        lng: s.coordinates!.lng,
        status: s.status,
        plannedArrivalAt: s.plannedArrivalAt,
        actualArrivalAt: s.actualArrivalAt,
      })),
  };
}

// ---------------------------------------------------------------------------
// Detalle de vehiculo
// ---------------------------------------------------------------------------

/** Traduce eventos GPS y detenciones a una linea de tiempo legible. */
function buildTimeline(
  route: Route | null,
  history: Position[],
  events: { id: string; type: string; timestamp: string; detail?: string; position?: { lat: number; lng: number } }[],
  workOrders: WorkOrder[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const settings = getOperationalSettings();

  if (route?.startedAt) {
    entries.push({
      id: `${route.id}-start`,
      kind: 'ruta_inicio',
      timestamp: route.startedAt,
      title: 'Inicio de ruta',
      detail: `${route.code} - ${route.name}`,
      position: route.plannedPath[0] ?? null,
    });
  }

  for (const workOrder of workOrders) {
    if (workOrder.actualArrivalAt) {
      entries.push({
        id: `${workOrder.id}-enter`,
        kind: 'geocerca_entrada',
        timestamp: workOrder.actualArrivalAt,
        title: `Entrada geocerca ${workOrder.clientName}`,
        detail: workOrder.addressLine,
        position: workOrder.coordinates,
      });

      if (workOrder.deliveryConfirmation === 'gps') {
        entries.push({
          id: `${workOrder.id}-visit`,
          kind: 'visita_confirmada',
          timestamp: workOrder.actualArrivalAt,
          title: 'Visita GPS confirmada',
          detail: `${workOrder.number} a ${workOrder.closestApproachMeters ?? 0} m del domicilio`,
          position: workOrder.coordinates,
        });
      }
    }

    if (workOrder.actualDepartureAt) {
      entries.push({
        id: `${workOrder.id}-exit`,
        kind: 'geocerca_salida',
        timestamp: workOrder.actualDepartureAt,
        title: `Salida geocerca ${workOrder.clientName}`,
        detail: null,
        position: workOrder.coordinates,
      });
    }
  }

  const stops = detectStops({
    positions: history,
    movingSpeedThresholdKmh: settings.gps.movingSpeedThresholdKmh,
    prolongedStopSeconds: settings.route.prolongedStopSeconds,
  });

  for (const stop of stops.filter((s) => s.prolonged)) {
    entries.push({
      id: `stop-${stop.startedAt}`,
      kind: 'detencion',
      timestamp: stop.startedAt,
      title: 'Detencion prolongada',
      detail: `${Math.round(stop.durationSeconds / 60)} minutos sin movimiento`,
      position: stop.position,
    });
  }

  for (const event of events) {
    if (event.type === 'harsh_braking') {
      entries.push({
        id: event.id,
        kind: 'desvio',
        timestamp: event.timestamp,
        title: 'Desvio detectado',
        detail: event.detail ?? null,
        position: event.position ?? null,
      });
    } else if (event.type === 'ignition_on' && event.detail?.includes('Retorno')) {
      entries.push({
        id: event.id,
        kind: 'retorno_ruta',
        timestamp: event.timestamp,
        title: 'Retorno a ruta',
        detail: event.detail,
        position: event.position ?? null,
      });
    } else if (event.type === 'device_offline' || event.type === 'device_online') {
      entries.push({
        id: event.id,
        kind: 'evento_gps',
        timestamp: event.timestamp,
        title: event.type === 'device_offline' ? 'Perdida de senal' : 'Senal recuperada',
        detail: event.detail ?? null,
        position: event.position ?? null,
      });
    }
  }

  return entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export async function loadVehicleDetail(vehicleId: VehicleId): Promise<VehicleDetail | null> {
  const gps = getGpsProvider();
  const operations = getOperationsProvider();
  const settings = getOperationalSettings();
  const now = new Date();

  const [context, drivers] = await Promise.all([loadFleetContext(), operations.getDrivers()]);
  const vehicle = context.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return null;

  const driverIndex = new Map(drivers.map((d) => [d.id as string, { id: d.id as string, fullName: d.fullName }]));
  const snapshot = buildVehicleSnapshot(vehicle, context, driverIndex, now);
  const driver = drivers.find((d) => d.id === vehicle.driverId) ?? null;

  const route = context.routes.find((r) => r.vehicleId === vehicleId) ?? null;
  const vehicleWorkOrders = context.workOrders
    .filter((w) => w.vehicleId === vehicleId)
    .sort((a, b) => (a.stopSequence ?? 0) - (b.stopSequence ?? 0));

  const [history, events] = await Promise.all([
    gps.getPositionHistory({
      vehicleId,
      from: new Date(now.getTime() - HISTORY_WINDOW_MS).toISOString(),
      to: now.toISOString(),
      limit: 600,
    }),
    gps.getVehicleEvents({ vehicleId, limit: 60 }),
  ]);

  const position = snapshot.position;
  const progress = route
    ? evaluateRouteProgress(route, position ? { lat: position.lat, lng: position.lng } : null)
    : null;

  const currentWorkOrder =
    vehicleWorkOrders.find((w) => w.status === 'en_cliente') ??
    vehicleWorkOrders.find((w) => w.status === 'proxima') ??
    null;

  const nextWorkOrder =
    vehicleWorkOrders.find(
      (w) => w.id !== currentWorkOrder?.id && !['visita_detectada', 'completada', 'cancelada'].includes(w.status),
    ) ?? null;

  // Kilometraje y tiempos de la jornada, medidos sobre el historial real.
  let distanceKm = 0;
  for (let i = 1; i < history.length; i += 1) {
    distanceKm += haversineMeters(history[i - 1]!, history[i]!) / 1000;
  }

  const stops = detectStops({
    positions: history,
    movingSpeedThresholdKmh: settings.gps.movingSpeedThresholdKmh,
    prolongedStopSeconds: settings.route.prolongedStopSeconds,
  });

  const stoppedSeconds = stops.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalSeconds =
    history.length >= 2
      ? Math.max(
          0,
          (new Date(history[history.length - 1]!.timestamp).getTime() -
            new Date(history[0]!.timestamp).getTime()) /
            1000,
        )
      : 0;

  const deliveriesCompleted = vehicleWorkOrders.filter((w) =>
    ['visita_detectada', 'completada'].includes(w.status),
  ).length;

  const communeName = position
    ? (resolveCommune({ lat: position.lat, lng: position.lng }, [...COMMUNES])?.name ?? null)
    : null;

  // ETA hacia el proximo destino operativo.
  let eta: VehicleDetail['eta'] = null;
  const target = currentWorkOrder ?? nextWorkOrder;
  if (position && target?.coordinates) {
    const remaining = vehicleWorkOrders.filter(
      (w) =>
        (w.stopSequence ?? 0) < (target.stopSequence ?? 0) &&
        !['visita_detectada', 'completada', 'cancelada'].includes(w.status),
    ).length;

    const result = await estimateEta({
      origin: { lat: position.lat, lng: position.lng },
      destination: target.coordinates,
      path: route?.plannedPath,
      currentSpeedKmh: position.speed,
      remainingStops: remaining,
      now,
    });
    eta = { minutes: result.minutes, arrivalAt: result.arrivalAt, distanceKm: result.distanceKm };
  }

  return {
    snapshot: { ...snapshot, driver },
    vehicle,
    driver,
    currentWorkOrder,
    nextWorkOrder,
    route: route ? toRouteGeometry(route, vehicle.plate) : null,
    routeProgress: {
      totalStops: progress?.totalStops ?? 0,
      completedStops: progress?.completedStops ?? 0,
      nextStopName: progress?.nextStop?.clientName ?? null,
      progressRatio: progress?.completionRatio ?? 0,
    },
    journey: {
      distanceKm: Math.round(distanceKm * 10) / 10,
      startedAt: route?.startedAt ?? history[0]?.timestamp ?? null,
      movingSeconds: Math.max(0, Math.round(totalSeconds - stoppedSeconds)),
      stoppedSeconds: Math.round(stoppedSeconds),
      deliveriesCompleted,
      deliveriesPending: Math.max(0, vehicleWorkOrders.length - deliveriesCompleted),
      communeName: communeName ?? (position?.communeCode ? getCommuneName(position.communeCode) : null),
    },
    eta,
    timeline: buildTimeline(route, history, events, vehicleWorkOrders),
    openAlerts: context.alerts.filter((a) => a.vehicleId === vehicleId && a.state !== 'resuelta'),
  };
}
