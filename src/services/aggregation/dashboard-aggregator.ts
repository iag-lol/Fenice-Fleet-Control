import 'server-only';

import { isUsableCoordinate } from '@/lib/geo';
import {
  buildRouteSummaries,
  buildVehicleSnapshot,
  loadFleetContext,
  toRouteGeometry,
} from '@/services/aggregation/fleet-aggregator';
import { loadClientContext, toClientMapPoints } from '@/services/aggregation/client-aggregator';
import { getOperationsProvider } from '@/services/registry';
import type { VehicleSnapshot, WorkOrder } from '@/types/core';
import type {
  AlertMapPoint,
  ClientsKpis,
  DashboardData,
  FleetKpis,
  KpiValue,
  MapSnapshot,
  OrdersKpis,
  WorkOrderMapPoint,
} from '@/types/views';

const MS_PER_DAY = 86_400_000;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * Construye un KPI con su tendencia. Cuando no hay base historica comparable
 * se devuelve `trend: null` y la UI omite el indicador en vez de inventar un
 * 0 % que el operador leeria como "sin cambios".
 */
function kpi(
  value: number,
  previous: number | null,
  goodDirection: 'up' | 'down' | 'neutral',
): KpiValue {
  if (previous === null) return { value, trend: null };

  return {
    value,
    trend: {
      previous,
      changeRatio: previous === 0 ? (value === 0 ? 0 : null) : (value - previous) / previous,
      goodDirection,
    },
  };
}

export async function loadDashboard(): Promise<DashboardData> {
  const operations = getOperationsProvider();
  const now = new Date();

  const [context, drivers, clientContext, historicalWorkOrders, alerts] = await Promise.all([
    loadFleetContext(),
    operations.getDrivers(),
    loadClientContext(),
    operations.getWorkOrders({ from: new Date(now.getTime() - 8 * MS_PER_DAY).toISOString() }),
    operations.getAlerts(),
  ]);

  const driverIndex = new Map(
    drivers.map((d) => [d.id as string, { id: d.id as string, fullName: d.fullName }]),
  );

  const vehicles: VehicleSnapshot[] = context.vehicles.map((vehicle) => {
    const snapshot = buildVehicleSnapshot(vehicle, context, driverIndex, now);
    return { ...snapshot, driver: drivers.find((d) => d.id === vehicle.driverId) ?? null };
  });

  // --- Flota ---------------------------------------------------------------
  const fleet: FleetKpis = {
    total: kpi(vehicles.length, null, 'neutral'),
    enRuta: kpi(vehicles.filter((v) => v.status === 'en_ruta').length, null, 'up'),
    detenidos: kpi(vehicles.filter((v) => v.status === 'detenido').length, null, 'down'),
    offline: kpi(vehicles.filter((v) => v.status === 'offline').length, null, 'down'),
    conAlertas: kpi(vehicles.filter((v) => v.openAlertCount > 0).length, null, 'down'),
  };

  // --- Pedidos -------------------------------------------------------------
  const todayWorkOrders = historicalWorkOrders.filter((w) =>
    isSameDay(new Date(w.scheduledDate), now),
  );
  const yesterdayWorkOrders = historicalWorkOrders.filter((w) =>
    isSameDay(new Date(w.scheduledDate), new Date(now.getTime() - MS_PER_DAY)),
  );

  const countBy = (list: WorkOrder[], predicate: (w: WorkOrder) => boolean): number =>
    list.filter(predicate).length;

  const visitedPredicate = (w: WorkOrder): boolean =>
    w.status === 'visita_detectada' || w.status === 'completada';

  const orders: OrdersKpis = {
    despachosHoy: kpi(todayWorkOrders.length, yesterdayWorkOrders.length, 'neutral'),
    pendientes: kpi(
      countBy(todayWorkOrders, (w) => ['pendiente', 'asignada', 'preparando'].includes(w.status)),
      countBy(yesterdayWorkOrders, (w) => ['pendiente', 'asignada', 'preparando'].includes(w.status)),
      'down',
    ),
    enRuta: kpi(countBy(todayWorkOrders, (w) => w.status === 'en_ruta'), null, 'neutral'),
    proximasEntregas: kpi(
      countBy(todayWorkOrders, (w) => w.status === 'proxima' || w.status === 'en_cliente'),
      null,
      'neutral',
    ),
    visitados: kpi(
      countBy(todayWorkOrders, visitedPredicate),
      countBy(yesterdayWorkOrders, visitedPredicate),
      'up',
    ),
    finalizados: kpi(
      countBy(todayWorkOrders, (w) => w.status === 'completada'),
      countBy(yesterdayWorkOrders, (w) => w.status === 'completada'),
      'up',
    ),
    conIncidencia: kpi(
      countBy(todayWorkOrders, (w) => w.status === 'incidencia'),
      countBy(yesterdayWorkOrders, (w) => w.status === 'incidencia'),
      'down',
    ),
  };

  // --- Clientes ------------------------------------------------------------
  const snapshots = clientContext.snapshots;
  const clients: ClientsKpis = {
    total: kpi(snapshots.length, null, 'up'),
    activos: kpi(snapshots.filter((s) => s.activityStatus === 'active').length, null, 'up'),
    enObservacion: kpi(snapshots.filter((s) => s.activityStatus === 'warning').length, null, 'down'),
    dormidos: kpi(snapshots.filter((s) => s.activityStatus === 'dormant').length, null, 'down'),
    visitadosHoy: kpi(snapshots.filter((s) => s.visitedToday).length, null, 'up'),
  };

  // --- Alertas -------------------------------------------------------------
  const openAlerts = alerts.filter((a) => a.state !== 'resuelta');
  const alertsKpis = {
    criticas: kpi(openAlerts.filter((a) => a.severity === 'critical').length, null, 'down'),
    advertencias: kpi(openAlerts.filter((a) => a.severity === 'warning').length, null, 'down'),
    informativas: kpi(openAlerts.filter((a) => a.severity === 'info').length, null, 'neutral'),
  };

  // --- Tendencia de entregas ------------------------------------------------
  const deliveryTrend: DashboardData['deliveryTrend'] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * MS_PER_DAY);
    const dayWorkOrders = historicalWorkOrders.filter((w) =>
      isSameDay(new Date(w.scheduledDate), day),
    );
    deliveryTrend.push({
      date: day.toISOString(),
      completadas: countBy(dayWorkOrders, visitedPredicate),
      incidencias: countBy(dayWorkOrders, (w) => w.status === 'incidencia'),
    });
  }

  return {
    generatedAt: now.toISOString(),
    fleet,
    orders,
    clients,
    alerts: alertsKpis,
    deliveryTrend,
    recentAlerts: openAlerts.slice(0, 8),
    activeRoutes: buildRouteSummaries(
      context,
      drivers.map((d) => ({ id: d.id as string, fullName: d.fullName })),
    ),
    vehicles,
  };
}

/**
 * Instantanea completa del mapa operacional.
 *
 * Se entrega en una sola respuesta para que el mapa pinte todas sus capas sin
 * cascadas de peticiones. Las posiciones vivas llegan aparte, por el stream.
 */
export async function loadMapSnapshot(): Promise<MapSnapshot> {
  const operations = getOperationsProvider();
  const now = new Date();

  const [context, drivers, clientContext] = await Promise.all([
    loadFleetContext(),
    operations.getDrivers(),
    loadClientContext(),
  ]);

  const driverIndex = new Map(
    drivers.map((d) => [d.id as string, { id: d.id as string, fullName: d.fullName }]),
  );

  const vehicles = context.vehicles.map((vehicle) => {
    const snapshot = buildVehicleSnapshot(vehicle, context, driverIndex, now);
    return { ...snapshot, driver: drivers.find((d) => d.id === vehicle.driverId) ?? null };
  });

  const plateByVehicle = new Map(context.vehicles.map((v) => [v.id as string, v.plate]));

  const alertPoints: AlertMapPoint[] = context.alerts
    .filter((a) => isUsableCoordinate(a.position))
    .map((a) => ({
      alertId: a.id,
      severity: a.severity,
      title: a.title,
      lat: a.position!.lat,
      lng: a.position!.lng,
      timestamp: a.timestamp,
    }));

  const pendingWorkOrders: WorkOrderMapPoint[] = context.workOrders
    .filter(
      (w) =>
        isUsableCoordinate(w.coordinates) &&
        !['completada', 'visita_detectada', 'cancelada'].includes(w.status),
    )
    .map((w) => ({
      workOrderId: w.id,
      number: w.number,
      clientName: w.clientName,
      addressLine: w.addressLine,
      communeName: w.communeName,
      lat: w.coordinates!.lat,
      lng: w.coordinates!.lng,
      status: w.status,
      priority: w.priority,
    }));

  return {
    generatedAt: now.toISOString(),
    vehicles,
    clients: toClientMapPoints(clientContext.snapshots),
    routes: context.routes.map((route) =>
      toRouteGeometry(route, route.vehicleId ? (plateByVehicle.get(route.vehicleId) ?? null) : null),
    ),
    geofences: context.geofences,
    alerts: alertPoints,
    pendingWorkOrders,
    // La geometria comunal NO viaja aqui: pesa cientos de kilobytes y su capa
    // viene desactivada. Se sirve aparte, en /api/comunas, cuando se activa.
    communes: [],
  };
}
