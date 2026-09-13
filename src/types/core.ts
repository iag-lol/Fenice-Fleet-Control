/**
 * Modelo de datos interno de Fenice Fleet Control.
 *
 * Estos tipos son la representacion CANONICA que consume toda la aplicacion.
 * Ninguna capa visual debe depender del esquema de un proveedor externo
 * (Traccar, base de datos de Fenice, etc.). Los adaptadores de
 * `src/services/**` traducen hacia estos tipos mediante mappers dedicados.
 */

/** Identificadores opacos: nunca derivar significado de su contenido. */
export type VehicleId = string & { readonly __brand: 'VehicleId' };
export type DriverId = string & { readonly __brand: 'DriverId' };
export type ClientId = string & { readonly __brand: 'ClientId' };
export type OrderId = string & { readonly __brand: 'OrderId' };
export type WorkOrderId = string & { readonly __brand: 'WorkOrderId' };
export type RouteId = string & { readonly __brand: 'RouteId' };
export type GeofenceId = string & { readonly __brand: 'GeofenceId' };
export type AlertId = string & { readonly __brand: 'AlertId' };
export type DeviceId = string & { readonly __brand: 'DeviceId' };

export const asVehicleId = (v: string): VehicleId => v as VehicleId;
export const asDriverId = (v: string): DriverId => v as DriverId;
export const asClientId = (v: string): ClientId => v as ClientId;
export const asOrderId = (v: string): OrderId => v as OrderId;
export const asWorkOrderId = (v: string): WorkOrderId => v as WorkOrderId;
export const asRouteId = (v: string): RouteId => v as RouteId;
export const asGeofenceId = (v: string): GeofenceId => v as GeofenceId;
export const asAlertId = (v: string): AlertId => v as AlertId;
export const asDeviceId = (v: string): DeviceId => v as DeviceId;

/** Fecha en ISO 8601 con zona horaria. Todo el sistema serializa asi. */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// Geografia
// ---------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Division administrativa. En Chile: comuna dentro de una region. */
export interface Commune {
  code: string;
  name: string;
  region: string;
  /** Centroide aproximado, usado para encuadres y analisis territorial. */
  center: LatLng;
  /** Poligono simplificado para deteccion punto-en-comuna. */
  boundary: LatLng[];
}

// ---------------------------------------------------------------------------
// Telemetria GPS
// ---------------------------------------------------------------------------

export type IgnitionState = 'on' | 'off' | 'unknown';

/**
 * Una posicion GPS normalizada. Todo proveedor debe producir esta forma.
 * Los campos opcionales reflejan que no todo dispositivo los reporta.
 */
export interface Position {
  simulated?: boolean;
  /** Ajuste visual inferido. lat/lng y timestamp siguen siendo la medicion original. */
  roadMatch?: { fromTimestamp: IsoDateTime; confidence: number; path: LatLng[] };
  vehicleId: VehicleId;
  deviceId: DeviceId;
  /** Momento en que el dispositivo registro la posicion. */
  timestamp: IsoDateTime;
  /** Momento en que el servidor la recibio. Permite medir latencia real. */
  receivedAt?: IsoDateTime;
  lat: number;
  lng: number;
  /** km/h */
  speed: number;
  /** Grados 0-359, 0 = norte. */
  heading: number;
  altitude?: number;
  accuracy?: number;
  ignition: IgnitionState;
  /** Odometro acumulado en kilometros, si el equipo lo entrega. */
  odometerKm?: number;
  /** Nivel de bateria del equipo (0-100). */
  batteryLevel?: number;
  /** Direccion inversa-geocodificada, si esta disponible en cache. */
  address?: string;
  communeCode?: string;
  valid: boolean;
}

export type DeviceConnectionState = 'online' | 'stale' | 'lost' | 'offline' | 'unknown';

export interface DeviceStatus {
  deviceId: DeviceId;
  vehicleId: VehicleId;
  imei?: string;
  connection: DeviceConnectionState;
  lastPositionAt: IsoDateTime | null;
  /** Segundos transcurridos desde la ultima posicion valida. */
  secondsSinceLastPosition: number | null;
  protocol?: string;
  model?: string;
}

export type GpsEventType =
  | 'ignition_on'
  | 'ignition_off'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'overspeed'
  | 'harsh_braking'
  | 'harsh_acceleration'
  | 'idle_start'
  | 'idle_end'
  | 'device_online'
  | 'device_offline'
  | 'power_cut'
  | 'sos';

export interface GpsEvent {
  id: string;
  vehicleId: VehicleId;
  deviceId: DeviceId;
  type: GpsEventType;
  timestamp: IsoDateTime;
  position?: LatLng;
  geofenceId?: GeofenceId;
  /** Detalle libre proveniente del proveedor, ya normalizado a texto. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Flota
// ---------------------------------------------------------------------------

export type VehicleOperationalStatus =
  | 'en_ruta'
  | 'detenido'
  | 'inactivo'
  | 'offline'
  | 'mantenimiento';

/**
 * Estado de ACTIVIDAD del vehiculo, para el marcador del mapa.
 *
 * Es mas rico que `VehicleOperationalStatus` porque incorpora contexto
 * operacional que el estado base no conoce: si esta dentro de la geocerca de
 * un cliente, si se salio del corredor o si arrastra una alerta critica.
 *
 * Se mantienen ambos a proposito. El estado base gobierna los KPIs y los
 * filtros de flota, que llevan meses funcionando asi; este gobierna el color
 * del camion en el mapa, donde el operador necesita distinguir de un vistazo
 * "entregando" de "detenido sin motivo".
 */
export type VehicleActivityStatus =
  | 'moving'
  | 'delivering'
  | 'stopped'
  | 'deviated'
  | 'warning'
  | 'offline';

export interface GpsDevice {
  id: DeviceId;
  imei: string;
  model: string;
  simNumber?: string;
  /** Identificador que usa el proveedor externo (ej. Traccar deviceId). */
  externalId?: string;
  installedAt?: IsoDateTime;
  /** Proveedor de telemetria de ESTE equipo. Determina como se resuelve su posicion en vivo. */
  provider?: 'traccar' | '3dtracking';
  /** Servidor propio del equipo. `undefined` = usa el configurado por variables de entorno. */
  serverUrl?: string;
}

export type VehicleType = 'cisterna_semirremolque' | 'cisterna_rigido' | 'camioneta_estanque';

export interface Vehicle {
  id: VehicleId;
  /** Patente / placa. */
  plate: string;
  /** Codigo interno de flota, ej. "C-104". */
  fleetCode: string;
  brand: string;
  model: string;
  year: number;
  type: VehicleType;
  /**
   * Capacidad total del estanque, en litros.
   *
   * El combustible se mide y se factura en volumen, no en peso: el peso
   * depende de la densidad de cada producto y varia entre grados.
   */
  capacityLiters: number;
  /**
   * Compartimentos del estanque.
   *
   * Determina cuantos productos distintos puede transportar en un mismo viaje
   * sin mezclarlos, y por tanto que pedidos pueden agruparse en una ruta.
   */
  compartments: number;
  device: GpsDevice | null;
  driverId: DriverId | null;
  /** Planta de almacenamiento a la que pertenece. */
  depotName: string;
  active: boolean;
}

export interface Driver {
  id: DriverId;
  fullName: string;
  documentId: string;
  phone: string;
  licenseClass: string;
  licenseExpiresAt: IsoDateTime;
  active: boolean;
}

/** Vehiculo + su telemetria mas reciente, listo para render. */
export interface VehicleSnapshot {
  vehicle: Vehicle;
  driver: Driver | null;
  position: Position | null;
  status: VehicleOperationalStatus;
  device: DeviceStatus | null;
  /** OT en ejecucion, si existe. */
  activeWorkOrderId: WorkOrderId | null;
  activeRouteId: RouteId | null;
  /** Alertas abiertas asociadas al vehiculo. */
  openAlertCount: number;
  /** Estado de actividad usado por el marcador del mapa. */
  activityStatus: VehicleActivityStatus;
  /** Geocerca en la que se encuentra, si aplica. */
  insideGeofenceId: GeofenceId | null;
  insideGeofenceName: string | null;
  /** Distancia al corredor planificado, en metros. */
  deviationMeters: number | null;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export type ClientActivityStatus = 'active' | 'warning' | 'dormant';

export interface ClientLocation {
  id: string;
  clientId: ClientId;
  label: string;
  addressLine: string;
  communeCode: string;
  communeName: string;
  coordinates: LatLng | null;
  /** Como se obtuvieron las coordenadas. Relevante para confiabilidad. */
  coordinateSource: 'external' | 'geocoded' | 'manual' | 'none';
  isPrimary: boolean;
  /** Radio de geocerca de entrega en metros. Si es null se usa el default. */
  deliveryRadiusMeters: number | null;
}

/** Segmentos de una distribuidora de combustible. */
export type ClientSegment =
  | 'estacion_servicio'
  | 'transporte'
  | 'constructora'
  | 'agricola'
  | 'industrial'
  | 'minero'
  | 'pesquera'
  | 'generadora';

export interface Client {
  id: ClientId;
  code: string;
  legalName: string;
  tradeName: string;
  taxId: string;
  segment: ClientSegment;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  salesRep: string | null;
  locations: ClientLocation[];
  lastPurchaseAt: IsoDateTime | null;
  lastVisitAt: IsoDateTime | null;
  totalOrders: number;
  /** Monto acumulado historico en CLP. */
  lifetimeValue: number;
  createdAt: IsoDateTime;
  active: boolean;
}

/** Cliente + estado comercial calculado. Nunca calcular color en el componente. */
export interface ClientSnapshot {
  client: Client;
  activityStatus: ClientActivityStatus;
  daysSincePurchase: number | null;
  daysSinceVisit: number | null;
  primaryLocation: ClientLocation | null;
  hasPendingOrder: boolean;
  visitedToday: boolean;
}

// ---------------------------------------------------------------------------
// Pedidos y ordenes de trabajo
// ---------------------------------------------------------------------------

export type OrderStatus =
  | 'borrador'
  | 'confirmado'
  | 'preparacion'
  | 'despachado'
  | 'entregado'
  | 'anulado';

export interface OrderLine {
  sku: string;
  description: string;
  /** Volumen solicitado, en litros. */
  liters: number;
  /** Precio por litro en CLP. */
  pricePerLiter: number;
  /** Clasificacion de sustancia peligrosa, para la guia de despacho. */
  hazardClass: string;
  /** Compartimento del estanque asignado a esta linea, si ya fue planificado. */
  compartment: number | null;
}

export interface Order {
  id: OrderId;
  number: string;
  clientId: ClientId;
  locationId: string;
  status: OrderStatus;
  createdAt: IsoDateTime;
  requestedDeliveryDate: IsoDateTime;
  lines: OrderLine[];
  totalAmount: number;
  /** Volumen total del pedido, en litros. */
  totalLiters: number;
  /**
   * Peso de la carga, en kilogramos.
   *
   * Se deriva del volumen por la densidad de cada producto. Importa para el
   * limite legal de peso por eje, no para la facturacion.
   */
  totalWeightKg: number;
  notes: string | null;
}

export type WorkOrderStatus =
  | 'pendiente'
  | 'asignada'
  | 'preparando'
  | 'en_ruta'
  | 'proxima'
  | 'en_cliente'
  | 'visita_detectada'
  | 'completada'
  | 'incidencia'
  | 'cancelada';

export type WorkOrderPriority = 'baja' | 'normal' | 'alta' | 'urgente';

/**
 * Como se confirmo la entrega.
 *
 * La distincion es deliberada y NO debe colapsarse: la evidencia GPS prueba
 * que el camion estuvo en el domicilio, la confirmacion del conductor prueba
 * que hubo una entrega, y la del administrador prueba que alguien la valido a
 * mano. Confundirlas convertiria una presencia en una entrega.
 */
export type DeliveryConfirmationSource = 'gps' | 'driver' | 'admin' | 'manual' | 'none';

/**
 * Regla que decide cuando una presencia se convierte en entrega.
 *
 *  - `enter`  entrar al radio basta.
 *  - `dwell`  hay que permanecer un tiempo minimo.
 *  - `driver` la confirma el conductor desde su portal.
 *  - `hybrid` exige presencia GPS Y confirmacion del conductor.
 */
export type DeliveryDetectionMode = 'enter' | 'dwell' | 'driver' | 'hybrid';

/**
 * Evidencia de una deteccion de entrega.
 *
 * Nunca se cambia el estado de una OT sin dejar registro de POR QUE se cambio.
 * Este objeto es ese registro.
 */
export interface DeliveryDetectionEvidence {
  workOrderId: WorkOrderId;
  orderId: OrderId;
  clientId: ClientId;
  vehicleId: VehicleId;
  deviceId: DeviceId;
  geofenceId: GeofenceId;
  /** Regla aplicada para tomar la decision. */
  mode: DeliveryDetectionMode;
  enteredAt: IsoDateTime;
  exitedAt: IsoDateTime | null;
  dwellSeconds: number;
  /** Menor distancia registrada al domicilio, en metros. */
  closestApproachMeters: number;
  position: LatLng;
  /** Permanencia minima exigida por la regla, en segundos. */
  requiredDwellSeconds: number;
  /** Radio de la geocerca aplicada, en metros. */
  radiusMeters: number;
  detectedAt: IsoDateTime;
  source: DeliveryConfirmationSource;
}

export interface WorkOrder {
  id: WorkOrderId;
  number: string;
  orderId: OrderId;
  orderNumber: string;
  clientId: ClientId;
  clientName: string;
  locationId: string;
  addressLine: string;
  communeCode: string;
  communeName: string;
  coordinates: LatLng | null;
  vehicleId: VehicleId | null;
  driverId: DriverId | null;
  routeId: RouteId | null;
  /** Posicion dentro de la ruta, 1-indexado. */
  stopSequence: number | null;
  scheduledDate: IsoDateTime;
  /** Ventana horaria comprometida. */
  scheduledWindowStart: IsoDateTime | null;
  scheduledWindowEnd: IsoDateTime | null;
  estimatedArrivalAt: IsoDateTime | null;
  actualArrivalAt: IsoDateTime | null;
  actualDepartureAt: IsoDateTime | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  geofenceId: GeofenceId | null;
  deliveryConfirmation: DeliveryConfirmationSource;
  /** Distancia minima registrada entre el vehiculo y el domicilio, en metros. */
  closestApproachMeters: number | null;
  dwellSeconds: number | null;
  notes: string | null;
  /** Token opcional para seguimiento publico endurecido. */
  trackingToken: string | null;
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

export type RouteStatus = 'planificada' | 'en_curso' | 'completada' | 'cancelada';

export interface RouteStop {
  sequence: number;
  workOrderId: WorkOrderId;
  clientId: ClientId;
  clientName: string;
  addressLine: string;
  communeName: string;
  coordinates: LatLng | null;
  plannedArrivalAt: IsoDateTime | null;
  actualArrivalAt: IsoDateTime | null;
  status: WorkOrderStatus;
}

export interface Route {
  id: RouteId;
  code: string;
  name: string;
  date: IsoDateTime;
  vehicleId: VehicleId | null;
  driverId: DriverId | null;
  status: RouteStatus;
  /** Comunas que la ruta esta autorizada a recorrer. */
  authorizedCommuneCodes: string[];
  stops: RouteStop[];
  /** Corredor planificado. Base para el motor de cumplimiento de ruta. */
  plannedPath: LatLng[];
  /** Traza realmente ejecutada, alimentada por el historial GPS. */
  executedPath: LatLng[];
  plannedDistanceKm: number;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Geocercas
// ---------------------------------------------------------------------------

export type GeofenceKind =
  | 'cliente'
  | 'centro_operacional'
  | 'zona_autorizada'
  | 'zona_restringida'
  | 'comuna'
  | 'ruta'
  | 'carga'
  | 'descarga'
  | 'personalizada';

/**
 * Que debe detectar una geocerca.
 *
 * Se declara por geocerca y no de forma global porque las necesidades son
 * distintas: en el domicilio de un cliente interesa la permanencia (indica
 * entrega), en un terminal de carga interesa el exceso de tiempo (indica
 * demora en playa), y en una zona restringida basta con la entrada.
 */
export type GeofenceTrigger =
  | 'entrada'
  | 'salida'
  | 'permanencia'
  | 'detencion'
  | 'exceso_tiempo'
  | 'entrada_fuera_horario'
  | 'salida_fuera_horario'
  | 'vehiculo_no_autorizado'
  | 'entrega_detectada'
  | 'paso_por_cliente';

export interface GeofenceRules {
  /** Eventos que esta geocerca debe generar. */
  triggers: GeofenceTrigger[];
  /** Permanencia minima para validar una visita, en segundos. */
  minDwellSeconds: number | null;
  /** Permanencia a partir de la cual se considera demora, en segundos. */
  maxDwellSeconds: number | null;
  /** Ventana horaria autorizada, en formato HH:mm. */
  allowedFrom: string | null;
  allowedTo: string | null;
  /** Vehiculos autorizados. Lista vacia significa "cualquiera". */
  allowedVehicleIds: string[];
  /** Severidad de las alertas que genere esta geocerca. */
  severity: AlertSeverity;
}

export const DEFAULT_GEOFENCE_RULES: GeofenceRules = {
  triggers: ['entrada', 'salida'],
  minDwellSeconds: null,
  maxDwellSeconds: null,
  allowedFrom: null,
  allowedTo: null,
  allowedVehicleIds: [],
  severity: 'info',
};

export interface CircleGeofence {
  shape: 'circle';
  center: LatLng;
  radiusMeters: number;
}

export interface PolygonGeofence {
  shape: 'polygon';
  vertices: LatLng[];
}

export type GeofenceGeometry = CircleGeofence | PolygonGeofence;

export interface Geofence {
  id: GeofenceId;
  name: string;
  description: string | null;
  kind: GeofenceKind;
  geometry: GeofenceGeometry;
  /** Entidad a la que pertenece (cliente, comuna, ruta...). */
  referenceId: string | null;
  /** Cliente, ruta o vehiculo asociado, para el filtrado del mapa. */
  clientId: ClientId | null;
  routeId: RouteId | null;
  vehicleId: VehicleId | null;
  communeCode: string | null;
  /**
   * Permanencia minima para considerar una visita valida, en segundos.
   * Se conserva en la raiz por compatibilidad con el motor de geocercas.
   */
  minDwellSeconds: number | null;
  /** Reglas de deteccion y alerta propias de esta geocerca. */
  rules: GeofenceRules;
  active: boolean;
  color: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
  /** Origen: generada por el sistema o creada por un operador. */
  origin: 'sistema' | 'manual';
}

export type GeofenceEventType = 'enter' | 'exit' | 'dwell_confirmed';

export interface GeofenceEvent {
  id: string;
  geofenceId: GeofenceId;
  geofenceName: string;
  vehicleId: VehicleId;
  workOrderId: WorkOrderId | null;
  orderId: OrderId | null;
  clientId: ClientId | null;
  type: GeofenceEventType;
  timestamp: IsoDateTime;
  position: LatLng;
  /** Distancia al centro de la geocerca en el momento del evento. */
  distanceMeters: number;
}

/** Evidencia operacional de una visita detectada por GPS. */
export interface CustomerVisit {
  id: string;
  clientId: ClientId;
  clientName: string;
  vehicleId: VehicleId;
  workOrderId: WorkOrderId | null;
  geofenceId: GeofenceId;
  enteredAt: IsoDateTime;
  exitedAt: IsoDateTime | null;
  dwellSeconds: number | null;
  closestApproachMeters: number;
  entryPosition: LatLng;
  confirmed: boolean;
}

export interface DeliveryEvent {
  id: string;
  workOrderId: WorkOrderId;
  orderId: OrderId;
  clientId: ClientId;
  vehicleId: VehicleId;
  detectedAt: IsoDateTime;
  source: DeliveryConfirmationSource;
  position: LatLng;
  distanceMeters: number;
  dwellSeconds: number | null;
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'critical';

export type AlertCategory = 'gps' | 'ruta' | 'geocerca' | 'cliente' | 'operacion';

export type AlertType =
  // GPS
  | 'gps_offline'
  | 'gps_sin_posicion_reciente'
  | 'gps_senal_recuperada'
  // Ruta
  | 'ruta_desvio'
  | 'ruta_fuera_de_comuna'
  | 'ruta_detencion_prolongada'
  | 'ruta_atrasada'
  // Geocerca
  | 'geocerca_entrada'
  | 'geocerca_salida'
  | 'geocerca_visita'
  | 'geocerca_entrega_detectada'
  // Cliente
  | 'cliente_pasa_amarillo'
  | 'cliente_pasa_rojo'
  | 'cliente_dormido'
  // Operacion
  | 'ot_sin_camion'
  | 'ot_atrasada'
  | 'pedido_sin_coordenadas'
  | 'direccion_invalida';

export type AlertState = 'nueva' | 'revisada' | 'resuelta';

export interface Alert {
  id: AlertId;
  type: AlertType;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: IsoDateTime;
  vehicleId: VehicleId | null;
  vehiclePlate: string | null;
  clientId: ClientId | null;
  clientName: string | null;
  workOrderId: WorkOrderId | null;
  workOrderNumber: string | null;
  position: LatLng | null;
  state: AlertState;
  acknowledgedAt: IsoDateTime | null;
  resolvedAt: IsoDateTime | null;
  /** Datos especificos del tipo, ya normalizados. */
  metadata: Record<string, string | number> | null;
}

// ---------------------------------------------------------------------------
// Seguimiento publico
// ---------------------------------------------------------------------------

/**
 * Proyeccion MINIMA expuesta al cliente final en /seguimiento.
 * Cualquier campo agregado aqui es informacion que sale de la empresa:
 * mantener estrictamente acotado.
 */
export interface TrackingSession {
  orderNumber: string;
  workOrderNumber: string;
  status: WorkOrderStatus;
  statusLabel: string;
  /** Progreso de la parada del cliente dentro de la ruta: 0-1. */
  progress: number;
  destination: {
    addressLine: string;
    communeName: string;
    coordinates: LatLng | null;
  };
  vehicle: {
    /** Identificador legible, no la patente completa si se desea anonimizar. */
    label: string;
    position: LatLng | null;
    heading: number;
    lastUpdateAt: IsoDateTime | null;
    moving: boolean;
  } | null;
  eta: {
    minutes: number | null;
    arrivalAt: IsoDateTime | null;
    distanceKm: number | null;
    /** Indica si el ETA proviene de un proveedor real o de estimacion interna. */
    source: 'routing_provider' | 'estimated';
  } | null;
  deliveredAt: IsoDateTime | null;
  /**
   * `false` cuando el pedido ya fue entregado o cancelado.
   *
   * Se expone para que el cliente entienda por que dejo de ver el camion, en
   * lugar de creer que el seguimiento se rompio.
   */
  trackingAllowed: boolean;
  lastUpdateAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Analitica
// ---------------------------------------------------------------------------

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
}

export interface CommuneCoverage {
  communeCode: string;
  communeName: string;
  center: LatLng;
  totalClients: number;
  activeClients: number;
  warningClients: number;
  dormantClients: number;
  ordersLast30Days: number;
  visitsLast30Days: number;
  /** 0-1. Proporcion de clientes activos sobre el total. */
  coverageRatio: number;
}

// ---------------------------------------------------------------------------
// Portal del conductor y evidencia de entrega
// ---------------------------------------------------------------------------

/**
 * Motivo por el que una parada no termino en entrega.
 *
 * Es una lista cerrada, no texto libre: el conductor elige con una mano en
 * la cabina, y la operacion puede contar cuantas veces pasa cada cosa. El
 * comentario libre acompana al motivo, no lo sustituye.
 */
export type DeliveryIncidentReason =
  | 'cliente_ausente'
  | 'sin_acceso'
  | 'estanque_lleno'
  | 'rechazo_cliente'
  | 'documentacion'
  | 'problema_vehiculo'
  | 'condiciones_seguridad'
  | 'direccion_incorrecta'
  | 'otro';

export interface ProofPhoto {
  id: string;
  /** Imagen ya comprimida en el telefono, como data URL. */
  dataUrl: string;
  byteSize: number;
  width: number;
  height: number;
  capturedAt: IsoDateTime;
}

/** Resultado que el conductor declara para una parada. */
export type DeliveryProofOutcome = 'entregada' | 'incidencia';

/**
 * Evidencia levantada en terreno.
 *
 * Es un artefacto de esta plataforma, no del ERP de Fenice: por eso admite
 * escritura sin romper el contrato de solo lectura sobre la base externa.
 */
export interface DeliveryProof {
  id: string;
  workOrderId: WorkOrderId;
  routeId: RouteId;
  driverId: DriverId | null;
  vehicleId: VehicleId | null;
  outcome: DeliveryProofOutcome;
  /** Litros efectivamente descargados. Puede diferir de lo pedido. */
  deliveredLiters: number | null;
  receiverName: string | null;
  receiverDocument: string | null;
  comment: string | null;
  incidentReason: DeliveryIncidentReason | null;
  photos: ProofPhoto[];
  /** Posicion del telefono al firmar. Independiente del GPS del camion. */
  capturedPosition: LatLng | null;
  capturedAccuracyMeters: number | null;
  /** Distancia entre el telefono y el domicilio declarado, en metros. */
  distanceToClientMeters: number | null;
  /** Momento en que el conductor cerro la parada en su telefono. */
  declaredAt: IsoDateTime;
  /** Momento en que el servidor la recibio. Difiere si venia en cola offline. */
  receivedAt: IsoDateTime;
  /** `true` cuando llego desde la cola sin conexion del telefono. */
  submittedOffline: boolean;
}

/** Parada tal como la ve el conductor en su telefono. */
export interface DriverStop {
  sequence: number;
  workOrderId: WorkOrderId;
  workOrderNumber: string;
  orderNumber: string;
  clientName: string;
  addressLine: string;
  communeName: string;
  coordinates: LatLng | null;
  contactName: string | null;
  contactPhone: string | null;
  scheduledWindowStart: IsoDateTime | null;
  scheduledWindowEnd: IsoDateTime | null;
  estimatedArrivalAt: IsoDateTime | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  /** Productos y litros comprometidos para esta parada. */
  lines: { productName: string; liters: number; hazardClass: string | null; compartment: number | null }[];
  totalLiters: number;
  notes: string | null;
  /** `true` si el GPS del camion ya coloco al vehiculo dentro de la geocerca. */
  insideGeofence: boolean;
  geofenceRadiusMeters: number | null;
  /** Evidencia ya registrada, si la hay. */
  proof: DeliveryProof | null;
  /** `false` cuando la parada ya esta cerrada y no admite mas cambios. */
  actionable: boolean;
}

/**
 * Todo lo que el portal del conductor puede ver.
 *
 * Deliberadamente NO incluye otras rutas, otros conductores ni la flota: un
 * enlace filtrado solo compromete la jornada de esa ruta.
 */
export interface DriverRouteSession {
  routeId: RouteId;
  routeCode: string;
  routeName: string;
  date: IsoDateTime;
  status: RouteStatus;
  driverName: string | null;
  vehiclePlate: string | null;
  vehicleLabel: string | null;
  vehicleCapacityLiters: number | null;
  stops: DriverStop[];
  totalStops: number;
  completedStops: number;
  incidentStops: number;
  pendingStops: number;
  totalLiters: number;
  /** Secuencia de la proxima parada abierta, si queda alguna. */
  nextStopSequence: number | null;
  /** Modo de deteccion vigente: define si basta el GPS o hace falta firmar. */
  deliveryMode: DeliveryDetectionMode;
  /** Vigencia del enlace, para avisar antes de que caduque. */
  tokenExpiresAt: IsoDateTime;
  serverTime: IsoDateTime;
}
