import 'server-only';

import { getOperationalSettings } from '@/services/settings/settings-store';
import { COMMUNES } from '@/data/communes';
import { buildClientSnapshot, calculateClientActivityStatus, classifyDormancy } from '@/lib/engines/client-activity';
import { isUsableCoordinate } from '@/lib/geo';
import { getOperationsProvider } from '@/services/registry';
import type {
  Client,
  ClientId,
  ClientSnapshot,
  CommuneCoverage,
  HeatmapPoint,
  Order,
  WorkOrder,
} from '@/types/core';
import type { ClientDetail, ClientMapPoint, TerritoryAnalysis } from '@/types/views';

/**
 * Composicion de la vista comercial: estado de clientes, dormidos, detalle e
 * inteligencia territorial.
 */

const MS_PER_DAY = 86_400_000;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export interface ClientContext {
  clients: Client[];
  workOrders: WorkOrder[];
  snapshots: ClientSnapshot[];
}

export async function loadClientContext(): Promise<ClientContext> {
  const operations = getOperationsProvider();
  const settings = getOperationalSettings();
  const now = new Date();

  const [clients, workOrders] = await Promise.all([
    operations.getClients(),
    operations.getWorkOrders({ from: new Date(now.getTime() - 30 * MS_PER_DAY).toISOString() }),
  ]);

  const pendingByClient = new Set(
    workOrders
      .filter((w) => !['completada', 'visita_detectada', 'cancelada'].includes(w.status))
      .map((w) => w.clientId as string),
  );

  const visitedTodayByClient = new Set(
    workOrders
      .filter(
        (w) =>
          w.actualArrivalAt !== null && isSameDay(new Date(w.actualArrivalAt), now),
      )
      .map((w) => w.clientId as string),
  );

  const snapshots = clients.map((client) =>
    buildClientSnapshot({
      client,
      settings,
      hasPendingOrder: pendingByClient.has(client.id),
      visitedToday: visitedTodayByClient.has(client.id),
      now,
    }),
  );

  return { clients, workOrders, snapshots };
}

/** Puntos de cliente listos para el mapa. Excluye los que no tienen coordenada. */
export function toClientMapPoints(snapshots: ClientSnapshot[]): ClientMapPoint[] {
  const points: ClientMapPoint[] = [];

  for (const snapshot of snapshots) {
    const location = snapshot.primaryLocation;
    if (!location || !isUsableCoordinate(location.coordinates)) continue;

    points.push({
      clientId: snapshot.client.id,
      code: snapshot.client.code,
      name: snapshot.client.tradeName,
      lat: location.coordinates.lat,
      lng: location.coordinates.lng,
      communeCode: location.communeCode,
      communeName: location.communeName,
      addressLine: location.addressLine,
      status: snapshot.activityStatus,
      daysSincePurchase: snapshot.daysSincePurchase,
      daysSinceVisit: snapshot.daysSinceVisit,
      hasPendingOrder: snapshot.hasPendingOrder,
      visitedToday: snapshot.visitedToday,
      lifetimeValue: snapshot.client.lifetimeValue,
      segment: snapshot.client.segment,
      salesRep: snapshot.client.salesRep,
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Clientes dormidos
// ---------------------------------------------------------------------------

export interface DormantClientRow {
  clientId: string;
  code: string;
  name: string;
  communeName: string;
  addressLine: string;
  lat: number | null;
  lng: number | null;
  lastPurchaseAt: string | null;
  daysSincePurchase: number | null;
  lastVisitAt: string | null;
  daysSinceVisit: number | null;
  salesRep: string | null;
  totalOrders: number;
  lifetimeValue: number;
  tier: 'en_riesgo' | 'dormido' | 'critico';
}

export async function loadDormantClients(): Promise<DormantClientRow[]> {
  const settings = getOperationalSettings();
  const { snapshots } = await loadClientContext();
  const now = new Date();

  return snapshots
    .filter((s) => s.activityStatus !== 'active')
    .map((snapshot) => {
      const activity = calculateClientActivityStatus({
        lastPurchaseAt: snapshot.client.lastPurchaseAt,
        lastVisitAt: snapshot.client.lastVisitAt,
        thresholds: settings.clients,
        now,
      });

      const location = snapshot.primaryLocation;

      return {
        clientId: snapshot.client.id,
        code: snapshot.client.code,
        name: snapshot.client.tradeName,
        communeName: location?.communeName ?? 'Sin comuna',
        addressLine: location?.addressLine ?? 'Sin direccion',
        lat: location?.coordinates?.lat ?? null,
        lng: location?.coordinates?.lng ?? null,
        lastPurchaseAt: snapshot.client.lastPurchaseAt,
        daysSincePurchase: snapshot.daysSincePurchase,
        lastVisitAt: snapshot.client.lastVisitAt,
        daysSinceVisit: snapshot.daysSinceVisit,
        salesRep: snapshot.client.salesRep,
        totalOrders: snapshot.client.totalOrders,
        lifetimeValue: snapshot.client.lifetimeValue,
        tier: classifyDormancy(activity.effectiveDays, settings.clients),
      } satisfies DormantClientRow;
    })
    .sort((a, b) => (b.daysSincePurchase ?? 99_999) - (a.daysSincePurchase ?? 99_999));
}

// ---------------------------------------------------------------------------
// Detalle de cliente
// ---------------------------------------------------------------------------

export async function loadClientDetail(clientId: ClientId): Promise<ClientDetail | null> {
  const operations = getOperationsProvider();
  const settings = getOperationalSettings();
  const now = new Date();

  const client = await operations.getClientById(clientId);
  if (!client) return null;

  const [orders, workOrders, visits, vehicles] = await Promise.all([
    operations.getOrders({ clientId, limit: 20 }),
    operations.getWorkOrders({ clientId }),
    operations.getCustomerVisits(500),
    operations.getVehicles(),
  ]);

  const plateByVehicle = new Map(vehicles.map((v) => [v.id as string, v.plate]));

  const clientWorkOrders = workOrders
    .filter((w) => w.clientId === clientId)
    .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime());

  const activeWorkOrder =
    clientWorkOrders.find((w) => ['en_cliente', 'proxima', 'en_ruta'].includes(w.status)) ?? null;

  const nextWorkOrder =
    clientWorkOrders.find((w) => ['pendiente', 'asignada', 'preparando'].includes(w.status)) ?? null;

  const snapshot = buildClientSnapshot({
    client,
    settings,
    hasPendingOrder: clientWorkOrders.some(
      (w) => !['completada', 'visita_detectada', 'cancelada'].includes(w.status),
    ),
    now,
  });

  const clientVisits = visits
    .filter((v) => v.clientId === clientId)
    .map((v) => ({
      id: v.id,
      date: v.enteredAt,
      vehiclePlate: plateByVehicle.get(v.vehicleId) ?? null,
      dwellSeconds: v.dwellSeconds,
      distanceMeters: v.closestApproachMeters,
      confirmed: v.confirmed,
    }));

  return {
    snapshot,
    recentOrders: orders,
    workOrders: clientWorkOrders,
    visits: clientVisits,
    activeWorkOrder,
    nextWorkOrder,
    assignedVehiclePlate:
      activeWorkOrder?.vehicleId ? (plateByVehicle.get(activeWorkOrder.vehicleId) ?? null) : null,
    totals: {
      orders: clientWorkOrders.length,
      delivered: clientWorkOrders.filter((w) => ['completada', 'visita_detectada'].includes(w.status))
        .length,
      incidents: clientWorkOrders.filter((w) => w.status === 'incidencia').length,
      lifetimeValue: client.lifetimeValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Inteligencia territorial
// ---------------------------------------------------------------------------

/**
 * Analisis por comuna. La cobertura se define como la proporcion de clientes
 * activos sobre el total: una comuna con muchos clientes dormidos NO esta
 * cubierta, aunque figure con presencia.
 */
export async function loadTerritoryAnalysis(): Promise<TerritoryAnalysis> {
  const operations = getOperationsProvider();
  const now = new Date();

  const [{ snapshots }, orders, visits] = await Promise.all([
    loadClientContext(),
    operations.getOrders({ from: new Date(now.getTime() - 30 * MS_PER_DAY).toISOString() }),
    operations.getCustomerVisits(1000),
  ]);

  const clientById = new Map(snapshots.map((s) => [s.client.id as string, s]));

  const ordersByCommune = new Map<string, number>();
  const orderPoints: HeatmapPoint[] = [];

  for (const order of orders as Order[]) {
    const snapshot = clientById.get(order.clientId);
    const location = snapshot?.primaryLocation;
    if (!location) continue;

    ordersByCommune.set(location.communeCode, (ordersByCommune.get(location.communeCode) ?? 0) + 1);
    if (isUsableCoordinate(location.coordinates)) {
      orderPoints.push({ lat: location.coordinates.lat, lng: location.coordinates.lng, weight: 1 });
    }
  }

  const visitsByCommune = new Map<string, number>();
  const visitPoints: HeatmapPoint[] = [];

  for (const visit of visits) {
    const snapshot = clientById.get(visit.clientId);
    const location = snapshot?.primaryLocation;
    if (!location) continue;

    visitsByCommune.set(location.communeCode, (visitsByCommune.get(location.communeCode) ?? 0) + 1);
    if (isUsableCoordinate(location.coordinates)) {
      visitPoints.push({ lat: location.coordinates.lat, lng: location.coordinates.lng, weight: 1 });
    }
  }

  const byCommune = new Map<string, { total: number; active: number; warning: number; dormant: number }>();
  const clientPoints: HeatmapPoint[] = [];
  const dormantPoints: HeatmapPoint[] = [];

  for (const snapshot of snapshots) {
    const location = snapshot.primaryLocation;
    if (!location) continue;

    const bucket = byCommune.get(location.communeCode) ?? { total: 0, active: 0, warning: 0, dormant: 0 };
    bucket.total += 1;
    if (snapshot.activityStatus === 'active') bucket.active += 1;
    else if (snapshot.activityStatus === 'warning') bucket.warning += 1;
    else bucket.dormant += 1;
    byCommune.set(location.communeCode, bucket);

    if (isUsableCoordinate(location.coordinates)) {
      // El peso pondera por valor del cliente: el calor refleja donde esta el
      // negocio, no solo donde hay puntos.
      const weight = 1 + Math.min(4, snapshot.client.lifetimeValue / 40_000_000);
      clientPoints.push({ lat: location.coordinates.lat, lng: location.coordinates.lng, weight });

      if (snapshot.activityStatus === 'dormant') {
        dormantPoints.push({
          lat: location.coordinates.lat,
          lng: location.coordinates.lng,
          weight: 1 + Math.min(3, (snapshot.daysSincePurchase ?? 0) / 180),
        });
      }
    }
  }

  const communes: CommuneCoverage[] = COMMUNES.map((commune) => {
    const bucket = byCommune.get(commune.code) ?? { total: 0, active: 0, warning: 0, dormant: 0 };
    return {
      communeCode: commune.code,
      communeName: commune.name,
      center: commune.center,
      totalClients: bucket.total,
      activeClients: bucket.active,
      warningClients: bucket.warning,
      dormantClients: bucket.dormant,
      ordersLast30Days: ordersByCommune.get(commune.code) ?? 0,
      visitsLast30Days: visitsByCommune.get(commune.code) ?? 0,
      coverageRatio: bucket.total === 0 ? 0 : bucket.active / bucket.total,
    };
  }).sort((a, b) => b.totalClients - a.totalClients);

  const totals = communes.reduce(
    (acc, c) => ({
      clients: acc.clients + c.totalClients,
      active: acc.active + c.activeClients,
      warning: acc.warning + c.warningClients,
      dormant: acc.dormant + c.dormantClients,
      communesCovered: acc.communesCovered + (c.totalClients > 0 ? 1 : 0),
      communesWithoutPresence: acc.communesWithoutPresence + (c.totalClients === 0 ? 1 : 0),
    }),
    { clients: 0, active: 0, warning: 0, dormant: 0, communesCovered: 0, communesWithoutPresence: 0 },
  );

  return {
    generatedAt: now.toISOString(),
    communes,
    totals,
    heatmaps: {
      clients: clientPoints,
      orders: orderPoints,
      visits: visitPoints,
      dormant: dormantPoints,
    },
  };
}
