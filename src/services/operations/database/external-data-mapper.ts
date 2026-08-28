import 'server-only';

import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { getCommuneName } from '@/data/communes';
import { isUsableCoordinate } from '@/lib/geo';
import {
  asClientId,
  asOrderId,
  asRouteId,
  asVehicleId,
  asWorkOrderId,
  type Client,
  type ClientLocation,
  type LatLng,
  type Order,
  type OrderStatus,
  type WorkOrder,
  type WorkOrderPriority,
  type WorkOrderStatus,
} from '@/types/core';

/**
 * ExternalDataMapper — frontera entre el esquema de Fenice y el modelo interno.
 *
 * NO SE ASUME el esquema real. Fenice todavia no ha entregado motor, tablas,
 * columnas ni relaciones. Por eso el mapeo se define en dos piezas:
 *
 *   1. `ExternalSchemaMapping`: declara QUE columna de Fenice alimenta cada
 *      campo interno. Es puro dato; se ajusta sin recompilar logica.
 *   2. Las funciones `mapExternal*`: aplican la declaracion y normalizan tipos,
 *      fechas, coordenadas y estados.
 *
 * Cuando llegue el esquema real, se edita `ExternalSchemaMapping` (o se carga
 * desde configuracion) y opcionalmente los diccionarios de estado. Ningun otro
 * archivo de la plataforma cambia.
 */

/** Fila generica devuelta por el driver de base de datos. */
export type ExternalRow = Record<string, unknown>;

export interface ColumnMapping {
  /** Nombre de la tabla o vista en la base de Fenice. */
  table: string;
  /** Campo interno -> columna externa. */
  columns: Record<string, string>;
}

export interface ExternalSchemaMapping {
  clients: ColumnMapping;
  clientLocations: ColumnMapping;
  orders: ColumnMapping;
  orderLines: ColumnMapping;
  workOrders: ColumnMapping;
  routes: ColumnMapping;
  vehicles: ColumnMapping;
  drivers: ColumnMapping;
  /** Traduccion de los estados de Fenice a los estados internos. */
  statusDictionaries: {
    orderStatus: Record<string, OrderStatus>;
    workOrderStatus: Record<string, WorkOrderStatus>;
    priority: Record<string, WorkOrderPriority>;
  };
}

/**
 * Mapeo PROVISIONAL basado en nombres frecuentes en ERP chilenos.
 * Es una hipotesis de trabajo, explicitamente marcada como tal, no una
 * afirmacion sobre el esquema de Fenice.
 */
export const PROVISIONAL_SCHEMA_MAPPING: ExternalSchemaMapping = {
  clients: {
    table: 'clientes',
    columns: {
      id: 'cliente_id',
      code: 'codigo',
      legalName: 'razon_social',
      tradeName: 'nombre_fantasia',
      taxId: 'rut',
      segment: 'segmento',
      contactName: 'contacto',
      phone: 'telefono',
      email: 'email',
      salesRep: 'vendedor',
      lastPurchaseAt: 'fecha_ultima_compra',
      lastVisitAt: 'fecha_ultima_visita',
      totalOrders: 'total_pedidos',
      lifetimeValue: 'monto_acumulado',
      createdAt: 'fecha_creacion',
      active: 'activo',
    },
  },
  clientLocations: {
    table: 'direcciones_cliente',
    columns: {
      id: 'direccion_id',
      clientId: 'cliente_id',
      label: 'glosa',
      addressLine: 'direccion',
      communeCode: 'comuna_codigo',
      communeName: 'comuna',
      lat: 'latitud',
      lng: 'longitud',
      isPrimary: 'principal',
    },
  },
  orders: {
    table: 'pedidos',
    columns: {
      id: 'pedido_id',
      number: 'numero_pedido',
      clientId: 'cliente_id',
      locationId: 'direccion_id',
      status: 'estado',
      createdAt: 'fecha_emision',
      requestedDeliveryDate: 'fecha_entrega',
      totalAmount: 'monto_total',
      totalLiters: 'litros_total',
      totalWeightKg: 'peso_total',
      notes: 'observaciones',
    },
  },
  orderLines: {
    table: 'pedido_detalle',
    columns: {
      orderId: 'pedido_id',
      sku: 'codigo_producto',
      description: 'descripcion',
      // El combustible se factura por volumen: litros y precio por litro.
      liters: 'litros',
      pricePerLiter: 'precio_litro',
      hazardClass: 'clase_peligro',
      compartment: 'compartimento',
    },
  },
  workOrders: {
    table: 'ordenes_trabajo',
    columns: {
      id: 'ot_id',
      number: 'numero_ot',
      orderId: 'pedido_id',
      orderNumber: 'numero_pedido',
      clientId: 'cliente_id',
      clientName: 'cliente_nombre',
      locationId: 'direccion_id',
      addressLine: 'direccion',
      communeCode: 'comuna_codigo',
      communeName: 'comuna',
      lat: 'latitud',
      lng: 'longitud',
      vehicleId: 'camion_id',
      driverId: 'conductor_id',
      routeId: 'ruta_id',
      stopSequence: 'secuencia',
      scheduledDate: 'fecha_programada',
      scheduledWindowStart: 'hora_desde',
      scheduledWindowEnd: 'hora_hasta',
      priority: 'prioridad',
      status: 'estado',
      notes: 'observaciones',
    },
  },
  routes: {
    table: 'rutas',
    columns: {
      id: 'ruta_id',
      code: 'codigo_ruta',
      name: 'nombre',
      date: 'fecha',
      vehicleId: 'camion_id',
      driverId: 'conductor_id',
      status: 'estado',
    },
  },
  vehicles: {
    table: 'camiones',
    columns: {
      id: 'camion_id',
      plate: 'patente',
      fleetCode: 'codigo_interno',
      brand: 'marca',
      model: 'modelo',
      year: 'anio',
      capacityKg: 'capacidad_kg',
      depotName: 'base',
      active: 'activo',
    },
  },
  drivers: {
    table: 'conductores',
    columns: {
      id: 'conductor_id',
      fullName: 'nombre',
      documentId: 'rut',
      phone: 'telefono',
      licenseClass: 'clase_licencia',
      licenseExpiresAt: 'vencimiento_licencia',
      active: 'activo',
    },
  },
  statusDictionaries: {
    orderStatus: {
      BORRADOR: 'borrador',
      PENDIENTE: 'confirmado',
      CONFIRMADO: 'confirmado',
      PREPARACION: 'preparacion',
      DESPACHADO: 'despachado',
      ENTREGADO: 'entregado',
      ANULADO: 'anulado',
    },
    workOrderStatus: {
      PENDIENTE: 'pendiente',
      ASIGNADA: 'asignada',
      PREPARANDO: 'preparando',
      EN_RUTA: 'en_ruta',
      EN_CLIENTE: 'en_cliente',
      ENTREGADA: 'completada',
      COMPLETADA: 'completada',
      INCIDENCIA: 'incidencia',
      ANULADA: 'cancelada',
      CANCELADA: 'cancelada',
    },
    priority: {
      BAJA: 'baja',
      NORMAL: 'normal',
      MEDIA: 'normal',
      ALTA: 'alta',
      URGENTE: 'urgente',
    },
  },
};

// ---------------------------------------------------------------------------
// Coerciones defensivas
// ---------------------------------------------------------------------------

export function readString(row: ExternalRow, column: string | undefined): string | null {
  if (!column) return null;
  const value = row[column];
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length === 0 ? null : text;
}

export function readNumber(row: ExternalRow, column: string | undefined): number | null {
  if (!column) return null;
  const value = row[column];
  if (value === null || value === undefined || value === '') return null;
  // Las bases legadas suelen entregar decimales con coma.
  const parsed = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readBoolean(row: ExternalRow, column: string | undefined): boolean {
  if (!column) return false;
  const value = row[column];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['1', 'true', 't', 'si', 'sí', 'y', 's'].includes(value.trim().toLowerCase());
  }
  return false;
}

/**
 * Fechas de origen heterogeneo: `Date`, epoch, ISO o formatos locales
 * `dd-mm-yyyy` / `dd/mm/yyyy`, que aparecen con frecuencia en ERP locales.
 */
export function readDate(row: ExternalRow, column: string | undefined): string | null {
  if (!column) return null;
  const value = row[column];
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const text = String(value).trim();

  const localMatch = /^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (localMatch) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = localMatch;
    const date = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function readCoordinates(
  row: ExternalRow,
  latColumn: string | undefined,
  lngColumn: string | undefined,
): LatLng | null {
  const lat = readNumber(row, latColumn);
  const lng = readNumber(row, lngColumn);
  if (lat === null || lng === null) return null;
  const point = { lat, lng };
  return isUsableCoordinate(point) ? point : null;
}

function translate<T extends string>(
  dictionary: Record<string, T>,
  raw: string | null,
  fallback: T,
): T {
  if (!raw) return fallback;
  return dictionary[raw.trim().toUpperCase()] ?? fallback;
}

// ---------------------------------------------------------------------------
// Mapeo de entidades
// ---------------------------------------------------------------------------

export function mapExternalClientLocation(
  row: ExternalRow,
  mapping: ExternalSchemaMapping,
): ClientLocation | null {
  const columns = mapping.clientLocations.columns;
  const id = readString(row, columns['id']);
  const clientId = readString(row, columns['clientId']);
  if (!id || !clientId) return null;

  const communeCode = readString(row, columns['communeCode']) ?? '';
  const coordinates = readCoordinates(row, columns['lat'], columns['lng']);

  return {
    id,
    clientId: asClientId(clientId),
    label: readString(row, columns['label']) ?? 'Direccion',
    addressLine: readString(row, columns['addressLine']) ?? 'Sin direccion',
    communeCode,
    communeName: readString(row, columns['communeName']) ?? getCommuneName(communeCode),
    coordinates,
    coordinateSource: coordinates ? 'external' : 'none',
    isPrimary: readBoolean(row, columns['isPrimary']),
    deliveryRadiusMeters: null,
  };
}

export function mapExternalClient(
  row: ExternalRow,
  locations: ClientLocation[],
  mapping: ExternalSchemaMapping,
): Client | null {
  const columns = mapping.clients.columns;
  const id = readString(row, columns['id']);
  if (!id) return null;

  const tradeName = readString(row, columns['tradeName']);
  const legalName = readString(row, columns['legalName']);

  return {
    id: asClientId(id),
    code: readString(row, columns['code']) ?? id,
    legalName: legalName ?? tradeName ?? 'Sin razon social',
    tradeName: tradeName ?? legalName ?? 'Sin nombre',
    taxId: readString(row, columns['taxId']) ?? '',
    // Segmento por defecto hasta que Fenice entregue su clasificacion.
    segment: 'estacion_servicio',
    contactName: readString(row, columns['contactName']),
    phone: readString(row, columns['phone']),
    email: readString(row, columns['email']),
    salesRep: readString(row, columns['salesRep']),
    locations,
    lastPurchaseAt: readDate(row, columns['lastPurchaseAt']),
    lastVisitAt: readDate(row, columns['lastVisitAt']),
    totalOrders: readNumber(row, columns['totalOrders']) ?? 0,
    lifetimeValue: readNumber(row, columns['lifetimeValue']) ?? 0,
    createdAt: readDate(row, columns['createdAt']) ?? new Date(0).toISOString(),
    active: columns['active'] ? readBoolean(row, columns['active']) : true,
  };
}

export function mapExternalOrder(
  row: ExternalRow,
  lines: Order['lines'],
  mapping: ExternalSchemaMapping,
): Order | null {
  const columns = mapping.orders.columns;
  const id = readString(row, columns['id']);
  const clientId = readString(row, columns['clientId']);
  if (!id || !clientId) return null;

  const createdAt = readDate(row, columns['createdAt']) ?? new Date().toISOString();

  return {
    id: asOrderId(id),
    number: readString(row, columns['number']) ?? id,
    clientId: asClientId(clientId),
    locationId: readString(row, columns['locationId']) ?? '',
    status: translate(
      mapping.statusDictionaries.orderStatus,
      readString(row, columns['status']),
      'confirmado',
    ),
    createdAt,
    requestedDeliveryDate: readDate(row, columns['requestedDeliveryDate']) ?? createdAt,
    lines,
    totalAmount: readNumber(row, columns['totalAmount']) ?? 0,
    totalLiters: readNumber(row, columns['totalLiters']) ?? 0,
    totalWeightKg: readNumber(row, columns['totalWeightKg']) ?? 0,
    notes: readString(row, columns['notes']),
  };
}

export function mapExternalWorkOrder(
  row: ExternalRow,
  mapping: ExternalSchemaMapping,
): WorkOrder | null {
  const columns = mapping.workOrders.columns;
  const id = readString(row, columns['id']);
  const clientId = readString(row, columns['clientId']);
  if (!id || !clientId) return null;

  const communeCode = readString(row, columns['communeCode']) ?? '';
  const vehicleId = readString(row, columns['vehicleId']);
  const routeId = readString(row, columns['routeId']);
  const orderId = readString(row, columns['orderId']);
  const scheduledDate = readDate(row, columns['scheduledDate']) ?? new Date().toISOString();

  return {
    id: asWorkOrderId(id),
    number: readString(row, columns['number']) ?? id,
    orderId: asOrderId(orderId ?? ''),
    orderNumber: readString(row, columns['orderNumber']) ?? '',
    clientId: asClientId(clientId),
    clientName: readString(row, columns['clientName']) ?? 'Cliente',
    locationId: readString(row, columns['locationId']) ?? '',
    addressLine: readString(row, columns['addressLine']) ?? 'Sin direccion',
    communeCode,
    communeName: readString(row, columns['communeName']) ?? getCommuneName(communeCode),
    coordinates: readCoordinates(row, columns['lat'], columns['lng']),
    vehicleId: vehicleId ? asVehicleId(vehicleId) : null,
    driverId: null,
    routeId: routeId ? asRouteId(routeId) : null,
    stopSequence: readNumber(row, columns['stopSequence']),
    scheduledDate,
    scheduledWindowStart: readDate(row, columns['scheduledWindowStart']),
    scheduledWindowEnd: readDate(row, columns['scheduledWindowEnd']),
    estimatedArrivalAt: null,
    actualArrivalAt: null,
    actualDepartureAt: null,
    priority: translate(
      mapping.statusDictionaries.priority,
      readString(row, columns['priority']),
      'normal',
    ),
    status: translate(
      mapping.statusDictionaries.workOrderStatus,
      readString(row, columns['status']),
      'pendiente',
    ),
    geofenceId: null,
    deliveryConfirmation: 'none',
    closestApproachMeters: null,
    dwellSeconds: null,
    notes: readString(row, columns['notes']),
    trackingToken: null,
  };
}

/** Radio de geocerca aplicado cuando la fuente externa no lo especifica. */
export const EXTERNAL_DEFAULT_GEOFENCE_RADIUS =
  DEFAULT_OPERATIONAL_SETTINGS.geofence.defaultRadiusMeters;
