import 'server-only';

import { randomUUID } from 'node:crypto';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { getGeofence } from '@/services/geofences/geofence-store';
import {
  asGeofenceId,
  asVehicleId,
  asWorkOrderId,
  type GeofenceEventType,
  type GeofenceEvent,
  type GeofenceId,
  type LatLng,
  type VehicleId,
} from '@/types/core';

/**
 * Historial de entradas/salidas de geocerca (tabla `eventos_geocerca`).
 *
 * Se escribe desde `geofence-detector.ts`, que evalua cada posicion nueva
 * contra las geocercas activas.
 */

const TABLE = 'eventos_geocerca';

// ---------------------------------------------------------------------------
// Backend en memoria (modo demostracion, sin Supabase configurado)
// ---------------------------------------------------------------------------

const globalForEvents = globalThis as unknown as {
  __feniceGeofenceEvents?: GeofenceEvent[];
};

function memoryStore(): GeofenceEvent[] {
  if (!globalForEvents.__feniceGeofenceEvents) globalForEvents.__feniceGeofenceEvents = [];
  return globalForEvents.__feniceGeofenceEvents;
}

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
  if (!isSupabaseConfigured()) {
    return [...memoryStore()]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

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

export interface RecordGeofenceEventInput {
  geofenceId: string;
  vehicleId: VehicleId;
  type: GeofenceEventType;
  timestamp: string;
  position: LatLng;
  distanceMeters: number;
}

/** Registra una entrada/salida detectada. */
export async function recordGeofenceEvent(input: RecordGeofenceEventInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    const geofence = await getGeofence(input.geofenceId as GeofenceId);
    memoryStore().push({
      id: randomUUID(),
      geofenceId: asGeofenceId(input.geofenceId),
      geofenceName: geofence?.name ?? 'Geocerca',
      vehicleId: input.vehicleId,
      workOrderId: null,
      orderId: null,
      clientId: null,
      type: input.type,
      timestamp: input.timestamp,
      position: input.position,
      distanceMeters: input.distanceMeters,
    });
    return;
  }

  const { error } = await getSupabaseClient().from(TABLE).insert({
    geocerca_id: input.geofenceId,
    vehiculo_id: input.vehicleId,
    tipo: input.type,
    marca_tiempo: input.timestamp,
    lat: input.position.lat,
    lng: input.position.lng,
    distancia_metros: input.distanceMeters,
  });

  if (error) console.error('[geofence-event-store] no fue posible registrar el evento:', error.message);
}
