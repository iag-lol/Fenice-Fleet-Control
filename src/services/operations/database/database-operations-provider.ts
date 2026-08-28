import 'server-only';

import { getServerEnv } from '@/config/env';
import { OperationsProviderError } from '@/services/operations/operations-provider';
import type {
  AlertQuery,
  ClientQuery,
  ExternalOperationsProvider,
  OperationsProviderInfo,
  OrderQuery,
  RouteQuery,
  WorkOrderQuery,
} from '@/services/operations/operations-provider';
import {
  mapExternalClient,
  mapExternalClientLocation,
  mapExternalOrder,
  mapExternalWorkOrder,
  PROVISIONAL_SCHEMA_MAPPING,
  type ExternalRow,
  type ExternalSchemaMapping,
} from '@/services/operations/database/external-data-mapper';
import type {
  Alert,
  AlertId,
  AlertState,
  Client,
  ClientId,
  ClientLocation,
  Commune,
  CustomerVisit,
  Driver,
  Geofence,
  GeofenceEvent,
  Order,
  OrderId,
  Route,
  RouteId,
  Vehicle,
  WorkOrder,
  WorkOrderId,
} from '@/types/core';

/**
 * Proveedor operacional contra la base de datos de Fenice.
 *
 * ESTADO: estructura completa, pendiente de credenciales y esquema real.
 *
 * Lo que ya esta resuelto aqui:
 *   - Contrato identico al proveedor mock (la UI no distingue cual esta activo).
 *   - Mapeo de filas a modelo interno, via `ExternalDataMapper`.
 *   - Guardas de solo lectura: toda sentencia se valida antes de ejecutarse.
 *   - Consultas parametrizadas: nunca concatenacion de valores.
 *
 * Lo que falta y REQUIERE a Fenice:
 *   - Motor (`EXTERNAL_DB_ENGINE`), host, puerto, base y credenciales READ ONLY.
 *   - Nombres reales de tablas, columnas y relaciones, para completar
 *     `ExternalSchemaMapping`.
 *   - El driver correspondiente (`pg`, `mysql2`, `mssql`...), que se instala
 *     una vez conocido el motor: agregar los cuatro drivers "por si acaso"
 *     seria peso muerto en el bundle.
 */

/** Sentencias prohibidas. La conexion es de solo lectura por contrato. */
const FORBIDDEN_STATEMENTS = /\b(insert|update|delete|alter|drop|truncate|create|grant|merge|replace|call|exec)\b/i;

export interface ExternalQueryResult {
  rows: ExternalRow[];
  latencyMs: number;
}

/** Ejecutor de consultas. Se inyecta al construir el driver real. */
export interface ExternalQueryExecutor {
  query(sql: string, params?: readonly unknown[]): Promise<ExternalQueryResult>;
  close(): Promise<void>;
}

export class DatabaseOperationsProvider implements ExternalOperationsProvider {
  readonly info: OperationsProviderInfo = {
    id: 'external',
    label: 'Base de datos Fenice',
    simulated: false,
    readOnly: true,
  };

  private readonly mapping: ExternalSchemaMapping;

  constructor(
    private readonly executor: ExternalQueryExecutor,
    mapping: ExternalSchemaMapping = PROVISIONAL_SCHEMA_MAPPING,
  ) {
    this.mapping = mapping;
  }

  /**
   * Unico punto de ejecucion de SQL. Rechaza cualquier sentencia que no sea
   * una lectura antes de tocar la red: la garantia de no escribir no depende
   * solo de los permisos del usuario de base de datos.
   */
  private async read(sql: string, params?: readonly unknown[]): Promise<ExternalRow[]> {
    const normalized = sql.trim();

    if (!/^select\b/i.test(normalized) && !/^with\b/i.test(normalized)) {
      throw new OperationsProviderError(
        'La base de datos de Fenice es de solo lectura: unicamente se permiten SELECT.',
      );
    }
    if (FORBIDDEN_STATEMENTS.test(normalized)) {
      throw new OperationsProviderError(
        'Se bloqueo una sentencia de escritura hacia la base de datos de Fenice.',
      );
    }

    const result = await this.executor.query(normalized, params);
    return result.rows;
  }

  private table(key: keyof Omit<ExternalSchemaMapping, 'statusDictionaries'>): string {
    const schema = getServerEnv().EXTERNAL_DB_SCHEMA;
    const table = this.mapping[key].table;
    return schema ? `${schema}.${table}` : table;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    try {
      const started = performance.now();
      await this.read('SELECT 1');
      return {
        ok: true,
        message: 'Conexion de solo lectura establecida con la base de datos de Fenice.',
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Error desconocido de conexion.',
        latencyMs: null,
      };
    }
  }

  async getCommunes(): Promise<Commune[]> {
    // La cartografia comunal no proviene del ERP. Se mantiene en la plataforma
    // hasta que Fenice entregue su propia capa territorial.
    const { COMMUNES } = await import('@/data/communes');
    return [...COMMUNES];
  }

  async getClients(query: ClientQuery = {}): Promise<Client[]> {
    const columns = this.mapping.clients.columns;
    const limit = Math.min(query.limit ?? 1000, 5000);

    const rows = await this.read(
      `SELECT * FROM ${this.table('clients')} ORDER BY ${columns['code']} LIMIT $1 OFFSET $2`,
      [limit, query.offset ?? 0],
    );

    const locationRows = await this.read(`SELECT * FROM ${this.table('clientLocations')}`);
    const locationsByClient = new Map<string, ClientLocation[]>();

    for (const row of locationRows) {
      const location = mapExternalClientLocation(row, this.mapping);
      if (!location) continue;
      const bucket = locationsByClient.get(location.clientId) ?? [];
      bucket.push(location);
      locationsByClient.set(location.clientId, bucket);
    }

    return rows
      .map((row) => {
        const id = String(row[this.mapping.clients.columns['id']!] ?? '');
        return mapExternalClient(row, locationsByClient.get(id) ?? [], this.mapping);
      })
      .filter((c): c is Client => c !== null);
  }

  async getClientById(id: ClientId): Promise<Client | null> {
    const columns = this.mapping.clients.columns;
    const rows = await this.read(
      `SELECT * FROM ${this.table('clients')} WHERE ${columns['id']} = $1`,
      [id],
    );
    if (rows.length === 0) return null;

    const locationRows = await this.read(
      `SELECT * FROM ${this.table('clientLocations')} WHERE ${this.mapping.clientLocations.columns['clientId']} = $1`,
      [id],
    );

    const locations = locationRows
      .map((row) => mapExternalClientLocation(row, this.mapping))
      .filter((l): l is ClientLocation => l !== null);

    return mapExternalClient(rows[0]!, locations, this.mapping);
  }

  async getOrders(query: OrderQuery = {}): Promise<Order[]> {
    const rows = await this.read(
      `SELECT * FROM ${this.table('orders')} ORDER BY ${this.mapping.orders.columns['createdAt']} DESC LIMIT $1`,
      [Math.min(query.limit ?? 500, 5000)],
    );
    return rows
      .map((row) => mapExternalOrder(row, [], this.mapping))
      .filter((o): o is Order => o !== null);
  }

  async getOrderById(id: OrderId): Promise<Order | null> {
    const rows = await this.read(
      `SELECT * FROM ${this.table('orders')} WHERE ${this.mapping.orders.columns['id']} = $1`,
      [id],
    );
    return rows[0] ? mapExternalOrder(rows[0], [], this.mapping) : null;
  }

  async getOrderByNumber(number: string): Promise<Order | null> {
    const rows = await this.read(
      `SELECT * FROM ${this.table('orders')} WHERE ${this.mapping.orders.columns['number']} = $1`,
      [number],
    );
    return rows[0] ? mapExternalOrder(rows[0], [], this.mapping) : null;
  }

  async getWorkOrders(query: WorkOrderQuery = {}): Promise<WorkOrder[]> {
    const rows = await this.read(
      `SELECT * FROM ${this.table('workOrders')} ORDER BY ${this.mapping.workOrders.columns['scheduledDate']} DESC LIMIT $1`,
      [Math.min(query.limit ?? 500, 5000)],
    );
    return rows
      .map((row) => mapExternalWorkOrder(row, this.mapping))
      .filter((w): w is WorkOrder => w !== null);
  }

  async getWorkOrderById(id: WorkOrderId): Promise<WorkOrder | null> {
    const rows = await this.read(
      `SELECT * FROM ${this.table('workOrders')} WHERE ${this.mapping.workOrders.columns['id']} = $1`,
      [id],
    );
    return rows[0] ? mapExternalWorkOrder(rows[0], this.mapping) : null;
  }

  async getWorkOrderByNumber(number: string): Promise<WorkOrder | null> {
    const columns = this.mapping.workOrders.columns;
    const rows = await this.read(
      `SELECT * FROM ${this.table('workOrders')} WHERE ${columns['number']} = $1 OR ${columns['orderNumber']} = $1`,
      [number],
    );
    return rows[0] ? mapExternalWorkOrder(rows[0], this.mapping) : null;
  }

  async getRoutes(_query: RouteQuery = {}): Promise<Route[]> {
    // El corredor planificado no existe en el ERP; se reconstruye a partir de
    // las paradas o se obtiene de un proveedor de routing. Pendiente de definir
    // con Fenice.
    return [];
  }

  async getRouteById(_id: RouteId): Promise<Route | null> {
    return null;
  }

  async getVehicles(): Promise<Vehicle[]> {
    return [];
  }

  async getDrivers(): Promise<Driver[]> {
    return [];
  }

  // Geocercas, visitas y alertas son artefactos de ESTA plataforma, no del ERP
  // de Fenice. Su persistencia definitiva ira en la base interna (DATABASE_URL).
  async getGeofences(): Promise<Geofence[]> {
    return [];
  }

  async getGeofenceEvents(): Promise<GeofenceEvent[]> {
    return [];
  }

  async getCustomerVisits(): Promise<CustomerVisit[]> {
    return [];
  }

  async getAlerts(_query: AlertQuery = {}): Promise<Alert[]> {
    return [];
  }

  async updateAlertState(_id: AlertId, _state: AlertState): Promise<Alert | null> {
    return null;
  }
}

/**
 * Crea el ejecutor de consultas segun `EXTERNAL_DB_ENGINE`.
 *
 * Lanza deliberadamente mientras no existan credenciales: es preferible un
 * mensaje explicito sobre lo que falta a una conexion silenciosamente rota.
 */
export function createExternalQueryExecutor(): ExternalQueryExecutor {
  const env = getServerEnv();

  const missing = [
    ['EXTERNAL_DB_ENGINE', env.EXTERNAL_DB_ENGINE],
    ['EXTERNAL_DB_HOST', env.EXTERNAL_DB_HOST],
    ['EXTERNAL_DB_NAME', env.EXTERNAL_DB_NAME],
    ['EXTERNAL_DB_USER', env.EXTERNAL_DB_USER],
    ['EXTERNAL_DB_PASSWORD', env.EXTERNAL_DB_PASSWORD],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new OperationsProviderError(
      `OPERATIONS_PROVIDER=external requiere: ${missing.join(', ')}. ` +
        'Consulta docs/EXTERNAL-DATABASE-INTEGRATION.md.',
    );
  }

  throw new OperationsProviderError(
    `Falta instalar el driver para ${env.EXTERNAL_DB_ENGINE}. ` +
      'Instala el paquete correspondiente y conectalo en createExternalQueryExecutor(). ' +
      'Consulta docs/EXTERNAL-DATABASE-INTEGRATION.md, seccion "Driver".',
  );
}
