import type {
  Alert,
  AlertId,
  AlertState,
  Client,
  ClientId,
  Commune,
  CustomerVisit,
  Driver,
  Geofence,
  GeofenceEvent,
  IsoDateTime,
  Order,
  OrderId,
  Route,
  RouteId,
  Vehicle,
  WorkOrder,
  WorkOrderId,
} from '@/types/core';

/**
 * Contrato de la fuente operacional de Fenice (clientes, pedidos, despachos,
 * rutas, direcciones y ordenes).
 *
 * IMPORTANTE: la base de datos de Fenice es de SOLO LECTURA. Este contrato no
 * expone ninguna operacion de escritura sobre entidades de negocio. Lo unico
 * mutable son artefactos propios de la plataforma (estado de alertas,
 * geocercas creadas aqui), que viven en el almacenamiento interno.
 */

export interface ClientQuery {
  search?: string;
  communeCodes?: string[];
  /** Filtro por estado comercial ya calculado aguas arriba. */
  clientIds?: ClientId[];
  limit?: number;
  offset?: number;
}

export interface OrderQuery {
  clientId?: ClientId;
  from?: IsoDateTime;
  to?: IsoDateTime;
  limit?: number;
}

export interface WorkOrderQuery {
  date?: IsoDateTime;
  from?: IsoDateTime;
  to?: IsoDateTime;
  vehicleId?: string;
  clientId?: ClientId;
  routeId?: RouteId;
  limit?: number;
}

export interface RouteQuery {
  date?: IsoDateTime;
  vehicleId?: string;
  limit?: number;
}

export interface AlertQuery {
  from?: IsoDateTime;
  to?: IsoDateTime;
  states?: AlertState[];
  limit?: number;
}

export interface OperationsProviderInfo {
  id: 'mock' | 'external';
  label: string;
  /** `true` cuando los datos son de demostracion. */
  simulated: boolean;
  /** `true` cuando la conexion es efectivamente de solo lectura. */
  readOnly: boolean;
}

export interface ExternalOperationsProvider {
  readonly info: OperationsProviderInfo;

  /** Verifica disponibilidad de la fuente. No lanza: devuelve el diagnostico. */
  healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }>;

  getCommunes(): Promise<Commune[]>;

  getClients(query?: ClientQuery): Promise<Client[]>;
  getClientById(id: ClientId): Promise<Client | null>;

  getOrders(query?: OrderQuery): Promise<Order[]>;
  getOrderById(id: OrderId): Promise<Order | null>;
  getOrderByNumber(number: string): Promise<Order | null>;

  getWorkOrders(query?: WorkOrderQuery): Promise<WorkOrder[]>;
  getWorkOrderById(id: WorkOrderId): Promise<WorkOrder | null>;
  /** Busqueda por numero de OT o de pedido. Base del seguimiento publico. */
  getWorkOrderByNumber(number: string): Promise<WorkOrder | null>;

  getRoutes(query?: RouteQuery): Promise<Route[]>;
  getRouteById(id: RouteId): Promise<Route | null>;

  getVehicles(): Promise<Vehicle[]>;
  getDrivers(): Promise<Driver[]>;

  getGeofences(): Promise<Geofence[]>;
  getGeofenceEvents(limit?: number): Promise<GeofenceEvent[]>;
  getCustomerVisits(limit?: number): Promise<CustomerVisit[]>;

  getAlerts(query?: AlertQuery): Promise<Alert[]>;
  /**
   * Actualiza el ciclo de vida de una alerta. Es artefacto de la plataforma,
   * no de la base de Fenice, por eso si admite escritura.
   */
  updateAlertState(id: AlertId, state: AlertState): Promise<Alert | null>;
}

export class OperationsProviderError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'OperationsProviderError';
  }
}
