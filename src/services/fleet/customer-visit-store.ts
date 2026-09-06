import 'server-only';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { asGeofenceId, asVehicleId, asWorkOrderId, type CustomerVisit, type LatLng } from '@/types/core';

/**
 * Visitas de cliente detectadas por GPS (tabla `visitas_cliente`).
 *
 * Igual que `geofence-event-store`: se alimenta del procesamiento de
 * telemetria (fuera de esta entrega). Sin Supabase, o sin ese procesamiento,
 * la lista viene vacia.
 */

const TABLE = 'visitas_cliente';

interface VisitRow {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  vehiculo_id: string;
  orden_trabajo_id: string | null;
  geocerca_id: string;
  entrada_at: string;
  salida_at: string | null;
  permanencia_segundos: number | null;
  distancia_minima_metros: number;
  posicion_entrada: LatLng;
  confirmada: boolean;
}

function rowToVisit(row: VisitRow): CustomerVisit {
  return {
    id: row.id,
    clientId: row.cliente_id as CustomerVisit['clientId'],
    clientName: row.cliente_nombre,
    vehicleId: asVehicleId(row.vehiculo_id),
    workOrderId: row.orden_trabajo_id ? asWorkOrderId(row.orden_trabajo_id) : null,
    geofenceId: asGeofenceId(row.geocerca_id),
    enteredAt: row.entrada_at,
    exitedAt: row.salida_at,
    dwellSeconds: row.permanencia_segundos,
    closestApproachMeters: row.distancia_minima_metros,
    entryPosition: row.posicion_entrada,
    confirmed: row.confirmada,
  };
}

export async function listCustomerVisits(limit = 100): Promise<CustomerVisit[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*')
    .order('entrada_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[customer-visit-store] no fue posible listar visitas:', error.message);
    return [];
  }
  return (data as VisitRow[]).map(rowToVisit);
}
