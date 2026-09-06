import 'server-only';

import { getDemoDataset } from '@/demo';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import type { RouteQuery } from '@/services/operations/operations-provider';
import {
  asDriverId,
  asRouteId,
  asVehicleId,
  asWorkOrderId,
  type LatLng,
  type Route,
  type RouteId,
  type RouteStop,
  type WorkOrderStatus,
} from '@/types/core';

/**
 * Rutas (planificacion) y sus paradas. Artefacto propio de la plataforma
 * (tablas `rutas` + `paradas_ruta`); ya NO viene del ERP de Fenice.
 *
 * `orden_trabajo_id` y `cliente_id` en `paradas_ruta` son referencias OPACAS
 * al ERP externo (texto, sin llave foranea): la OT y el cliente siguen
 * viviendo alli. Esta tabla solo guarda la PLANIFICACION de la ruta; el
 * estado real de cada parada (visita detectada, entrega confirmada) lo
 * calculan los motores de reglas sobre la telemetria y las declaraciones del
 * conductor, igual que hoy.
 */

const ROUTE_TABLE = 'rutas';
const STOP_TABLE = 'paradas_ruta';

interface StopRow {
  id: string;
  ruta_id: string;
  secuencia: number;
  orden_trabajo_id: string;
  cliente_id: string;
  cliente_nombre: string;
  direccion: string;
  comuna_nombre: string;
  lat: number | null;
  lng: number | null;
  llegada_planificada_at: string | null;
  llegada_real_at: string | null;
  estado: WorkOrderStatus;
}

interface RouteRow {
  id: string;
  codigo: string;
  nombre: string;
  fecha: string;
  vehiculo_id: string | null;
  conductor_id: string | null;
  estado: Route['status'];
  comunas_autorizadas: string[];
  trazado_planificado: LatLng[];
  trazado_ejecutado: LatLng[];
  distancia_planificada_km: number;
  iniciada_at: string | null;
  completada_at: string | null;
  paradas_ruta: StopRow[];
}

function rowToStop(row: StopRow): RouteStop {
  return {
    sequence: row.secuencia,
    workOrderId: asWorkOrderId(row.orden_trabajo_id),
    clientId: row.cliente_id as RouteStop['clientId'],
    clientName: row.cliente_nombre,
    addressLine: row.direccion,
    communeName: row.comuna_nombre,
    coordinates: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    plannedArrivalAt: row.llegada_planificada_at,
    actualArrivalAt: row.llegada_real_at,
    status: row.estado,
  };
}

function rowToRoute(row: RouteRow): Route {
  const stops = [...(row.paradas_ruta ?? [])].sort((a, b) => a.secuencia - b.secuencia).map(rowToStop);

  return {
    id: asRouteId(row.id),
    code: row.codigo,
    name: row.nombre,
    date: row.fecha,
    vehicleId: row.vehiculo_id ? asVehicleId(row.vehiculo_id) : null,
    driverId: row.conductor_id ? asDriverId(row.conductor_id) : null,
    status: row.estado,
    authorizedCommuneCodes: row.comunas_autorizadas ?? [],
    stops,
    plannedPath: row.trazado_planificado ?? [],
    executedPath: row.trazado_ejecutado ?? [],
    plannedDistanceKm: row.distancia_planificada_km,
    startedAt: row.iniciada_at,
    completedAt: row.completada_at,
  };
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function listRoutes(query: RouteQuery = {}): Promise<Route[]> {
  if (!isSupabaseConfigured()) {
    let routes = getDemoDataset().routes;
    if (query.date) {
      const target = new Date(query.date);
      routes = routes.filter((r) => isSameDay(new Date(r.date), target));
    }
    if (query.vehicleId) routes = routes.filter((r) => r.vehicleId === query.vehicleId);
    return query.limit ? routes.slice(0, query.limit) : routes;
  }

  let builder = getSupabaseClient().from(ROUTE_TABLE).select('*, paradas_ruta(*)');
  if (query.vehicleId) builder = builder.eq('vehiculo_id', query.vehicleId);
  builder = builder.order('fecha', { ascending: false });
  if (query.limit) builder = builder.limit(query.limit);

  const { data, error } = await builder;
  if (error) {
    console.error('[route-store] no fue posible listar rutas:', error.message);
    return [];
  }

  let routes = (data as RouteRow[]).map(rowToRoute);
  if (query.date) {
    const target = new Date(query.date);
    routes = routes.filter((r) => isSameDay(new Date(r.date), target));
  }
  return routes;
}

export async function getRouteByIdFromStore(id: RouteId): Promise<Route | null> {
  if (!isSupabaseConfigured()) {
    return getDemoDataset().index.routeById.get(id) ?? null;
  }

  const { data, error } = await getSupabaseClient()
    .from(ROUTE_TABLE)
    .select('*, paradas_ruta(*)')
    .eq('id', id)
    .maybeSingle<RouteRow>();

  if (error || !data) return null;
  return rowToRoute(data);
}
