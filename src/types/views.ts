import type {
  Alert,
  AlertSeverity,
  Client,
  ClientActivityStatus,
  ClientSnapshot,
  CommuneCoverage,
  Driver,
  Geofence,
  HeatmapPoint,
  IsoDateTime,
  LatLng,
  Order,
  Position,
  Route,
  Vehicle,
  VehicleSnapshot,
  WorkOrder,
} from '@/types/core';

/**
 * Modelos de vista.
 *
 * Son las formas que los componentes consumen. Se construyen en el servidor a
 * partir de los proveedores y de los motores de reglas, de modo que el cliente
 * no recalcula estados ni umbrales.
 */

export interface KpiTrend {
  /** Valor del periodo anterior comparable. */
  previous: number;
  /** Variacion relativa. `null` cuando no hay base de comparacion. */
  changeRatio: number | null;
  /** Direccion en la que un aumento es deseable. Define el color del indicador. */
  goodDirection: 'up' | 'down' | 'neutral';
}

export interface KpiValue {
  value: number;
  trend: KpiTrend | null;
}

export interface FleetKpis {
  total: KpiValue;
  enRuta: KpiValue;
  detenidos: KpiValue;
  offline: KpiValue;
  conAlertas: KpiValue;
}

export interface OrdersKpis {
  despachosHoy: KpiValue;
  pendientes: KpiValue;
  enRuta: KpiValue;
  proximasEntregas: KpiValue;
  visitados: KpiValue;
  finalizados: KpiValue;
  conIncidencia: KpiValue;
}

export interface ClientsKpis {
  total: KpiValue;
  activos: KpiValue;
  enObservacion: KpiValue;
  dormidos: KpiValue;
  visitadosHoy: KpiValue;
}

export interface AlertsKpis {
  criticas: KpiValue;
  advertencias: KpiValue;
  informativas: KpiValue;
}

export interface DashboardData {
  generatedAt: IsoDateTime;
  fleet: FleetKpis;
  orders: OrdersKpis;
  clients: ClientsKpis;
  alerts: AlertsKpis;
  /** Actividad de entregas de los ultimos 7 dias, para la tendencia. */
  deliveryTrend: { date: IsoDateTime; completadas: number; incidencias: number }[];
  recentAlerts: Alert[];
  activeRoutes: RouteSummary[];
  vehicles: VehicleSnapshot[];
}

export interface RouteSummary {
  routeId: string;
  code: string;
  name: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  status: Route['status'];
  totalStops: number;
  completedStops: number;
  nextStopName: string | null;
  nextStopEta: IsoDateTime | null;
  plannedDistanceKm: number;
  progressRatio: number;
}

/** Todo lo que el mapa operacional necesita en una sola respuesta. */
export interface MapSnapshot {
  generatedAt: IsoDateTime;
  vehicles: VehicleSnapshot[];
  clients: ClientMapPoint[];
  routes: RouteGeometry[];
  geofences: Geofence[];
  alerts: AlertMapPoint[];
  pendingWorkOrders: WorkOrderMapPoint[];
  communes: { code: string; name: string; center: LatLng; boundary: LatLng[] }[];
}

export interface ClientMapPoint {
  clientId: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  communeCode: string;
  communeName: string;
  addressLine: string;
  status: ClientActivityStatus;
  daysSincePurchase: number | null;
  daysSinceVisit: number | null;
  hasPendingOrder: boolean;
  visitedToday: boolean;
  lifetimeValue: number;
  segment: Client['segment'];
  salesRep: string | null;
}

export interface RouteGeometry {
  routeId: string;
  code: string;
  name: string;
  vehicleId: string | null;
  vehiclePlate: string | null;
  status: Route['status'];
  plannedPath: LatLng[];
  executedPath: LatLng[];
  executedSegments?: LatLng[][];
  /**
   * Cuanto del corredor planificado (`plannedPath`) ya quedo atras, medido en
   * metros desde su inicio segun la posicion ACTUAL del vehiculo. `null`
   * cuando no hay posicion en vivo con que calcularlo (se dibuja completo).
   *
   * No implica que el vehiculo haya seguido el corredor al pie de la letra:
   * es su proyeccion mas cercana sobre el, asi que un desvio breve tambien
   * "difumina" el tramo que queda atras.
   */
  plannedProgressMeters?: number | null;
  stops: {
    sequence: number;
    workOrderId: string;
    clientName: string;
    addressLine: string;
    lat: number;
    lng: number;
    status: WorkOrder['status'];
    plannedArrivalAt: IsoDateTime | null;
    actualArrivalAt: IsoDateTime | null;
  }[];
}

export interface AlertMapPoint {
  alertId: string;
  severity: AlertSeverity;
  title: string;
  lat: number;
  lng: number;
  timestamp: IsoDateTime;
}

export interface WorkOrderMapPoint {
  workOrderId: string;
  number: string;
  clientName: string;
  addressLine: string;
  communeName: string;
  lat: number;
  lng: number;
  status: WorkOrder['status'];
  priority: WorkOrder['priority'];
}

/** Ficha completa de un vehiculo, usada en el popup y en /flota/[id]. */
export interface VehicleDetail {
  snapshot: VehicleSnapshot;
  vehicle: Vehicle;
  driver: Driver | null;
  currentWorkOrder: WorkOrder | null;
  nextWorkOrder: WorkOrder | null;
  route: RouteGeometry | null;
  routeProgress: {
    totalStops: number;
    completedStops: number;
    nextStopName: string | null;
    progressRatio: number;
  };
  journey: {
    distanceKm: number | null;
    startedAt: IsoDateTime | null;
    movingSeconds: number;
    stoppedSeconds: number;
    deliveriesCompleted: number;
    deliveriesPending: number;
    communeName: string | null;
  };
  eta: { minutes: number | null; arrivalAt: IsoDateTime | null; distanceKm: number | null } | null;
  timeline: TimelineEntry[];
  openAlerts: Alert[];
}

export type TimelineEntryKind =
  | 'ruta_inicio'
  | 'geocerca_entrada'
  | 'geocerca_salida'
  | 'visita_confirmada'
  | 'detencion'
  | 'desvio'
  | 'retorno_ruta'
  | 'evento_gps'
  | 'ruta_fin';

export interface TimelineEntry {
  id: string;
  kind: TimelineEntryKind;
  timestamp: IsoDateTime;
  title: string;
  detail: string | null;
  position: LatLng | null;
}

/** Ficha de cliente para el panel del mapa y /clientes/[id]. */
export interface ClientDetail {
  snapshot: ClientSnapshot;
  recentOrders: Order[];
  workOrders: WorkOrder[];
  visits: {
    id: string;
    date: IsoDateTime;
    vehiclePlate: string | null;
    dwellSeconds: number | null;
    distanceMeters: number;
    confirmed: boolean;
  }[];
  activeWorkOrder: WorkOrder | null;
  nextWorkOrder: WorkOrder | null;
  assignedVehiclePlate: string | null;
  totals: { orders: number; delivered: number; incidents: number; lifetimeValue: number };
}

export interface TerritoryAnalysis {
  generatedAt: IsoDateTime;
  communes: CommuneCoverage[];
  totals: {
    clients: number;
    active: number;
    warning: number;
    dormant: number;
    communesCovered: number;
    communesWithoutPresence: number;
  };
  heatmaps: {
    clients: HeatmapPoint[];
    orders: HeatmapPoint[];
    visits: HeatmapPoint[];
    dormant: HeatmapPoint[];
  };
}

export type HeatmapMode = 'clients' | 'orders' | 'visits' | 'dormant';

export interface GlobalSearchResult {
  id: string;
  kind: 'cliente' | 'vehiculo' | 'orden' | 'pedido' | 'ruta' | 'geocerca' | 'comuna';
  title: string;
  subtitle: string;
  href: string;
  /** Coordenada para la accion "Ver en mapa". */
  position: LatLng | null;
  /** Parametro de enfoque para el mapa operacional. */
  mapFocus: { type: 'vehicle' | 'client' | 'workOrder' | 'route' | 'geofence' | 'commune'; id: string } | null;
}

export interface LivePositionsPayload {
  generatedAt: IsoDateTime;
  positions: Position[];
  vehicles: VehicleSnapshot[];
  simulator: { available: boolean; paused: boolean } | null;
}
