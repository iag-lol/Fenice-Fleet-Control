import 'server-only';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import {
  asGeofenceId,
  asVehicleId,
  asWorkOrderId,
  type GeofenceEvent,
  type GeofenceEventType,
} from '@/types/core';

/**
 * Historial de entradas/salidas de geocerca (tabla `eventos_geocerca`).
 *
 * Se escribe desde el procesamiento de telemetria (fuera del alcance de esta
 * entrega: ver nota en `docs/SUPABASE-INTEGRATION.md`). Sin Supabase
 * configurado, o mientras no exista ese procesamiento, la lista viene vacia
 * en lugar de inventar eventos.
 */

const TABLE = 'eventos_geocerca';

interface EventRow {
  id: string;
  geocerca_id: string;
  vehiculo_id: string;
  orden_trabajo_id: string | null;
  cliente_id: string | null;
  tipo: 'enter' | 'exit';
  marca_tiempo: string;
  lat: number;
  lng: number;
  distancia_metros: number;
  geocercas: { nombre: string } | { nombre: string }[] | null;
}

function rowToEvent(row: EventRow): GeofenceEvent {
  const geofence = Array.isArray(row.geocercas) ? row.geocercas[0] : row.geocercas;

  return {
    id: row.id,
    geofenceId: asGeofenceId(row.geocerca_id),
    geofenceName: geofence?.nombre ?? 'Geocerca',
    vehicleId: asVehicleId(row.vehiculo_id),
    workOrderId: row.orden_trabajo_id ? asWorkOrderId(row.orden_trabajo_id) : null,
    orderId: null,
    clientId: row.cliente_id as GeofenceEvent['clientId'],
    type: row.tipo as GeofenceEventType,
    timestamp: row.marca_tiempo,
    position: { lat: row.lat, lng: row.lng },
    distanceMeters: row.distancia_metros,
  };
}

export async function listGeofenceEvents(limit = 100): Promise<GeofenceEvent[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*, geocercas(nombre)')
    .order('marca_tiempo', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[geofence-event-store] no fue posible listar eventos:', error.message);
    return [];
  }
  return (data as EventRow[]).map(rowToEvent);
}
