import 'server-only';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import type { AlertQuery } from '@/services/operations/operations-provider';
import { asAlertId, asVehicleId, asWorkOrderId, type Alert, type AlertId, type AlertState } from '@/types/core';

/**
 * Alertas (tabla `alertas`).
 *
 * A diferencia de `MockOperationsProvider`, que CALCULA alertas en cada
 * peticion evaluando los motores de reglas sobre el dataset de demostracion,
 * esta tabla es donde vivirian las alertas de una operacion real, insertadas
 * por un proceso que evalue telemetria en vivo contra flota, rutas y
 * geocercas reales. Ese proceso queda fuera de esta entrega (ver
 * `docs/SUPABASE-INTEGRATION.md`): aqui solo se implementa el
 * almacenamiento — lectura, filtro y cambio de estado — que ese proceso ya
 * puede usar sin cambios cuando exista.
 */

const TABLE = 'alertas';

interface AlertRow {
  id: string;
  tipo: Alert['type'];
  categoria: Alert['category'];
  severidad: Alert['severity'];
  titulo: string;
  descripcion: string;
  marca_tiempo: string;
  vehiculo_id: string | null;
  vehiculo_patente: string | null;
  cliente_id: string | null;
  cliente_nombre: string | null;
  orden_trabajo_id: string | null;
  orden_trabajo_numero: string | null;
  lat: number | null;
  lng: number | null;
  estado: AlertState;
  reconocida_at: string | null;
  resuelta_at: string | null;
  metadata: Record<string, string | number> | null;
}

function rowToAlert(row: AlertRow): Alert {
  return {
    id: asAlertId(row.id),
    type: row.tipo,
    category: row.categoria,
    severity: row.severidad,
    title: row.titulo,
    description: row.descripcion,
    timestamp: row.marca_tiempo,
    vehicleId: row.vehiculo_id ? asVehicleId(row.vehiculo_id) : null,
    vehiclePlate: row.vehiculo_patente,
    clientId: row.cliente_id as Alert['clientId'],
    clientName: row.cliente_nombre,
    workOrderId: row.orden_trabajo_id ? asWorkOrderId(row.orden_trabajo_id) : null,
    workOrderNumber: row.orden_trabajo_numero,
    position: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    state: row.estado,
    acknowledgedAt: row.reconocida_at,
    resolvedAt: row.resuelta_at,
    metadata: row.metadata,
  };
}

export async function listAlerts(query: AlertQuery = {}): Promise<Alert[]> {
  if (!isSupabaseConfigured()) return [];

  let builder = getSupabaseClient().from(TABLE).select('*');
  if (query.states?.length) builder = builder.in('estado', query.states);
  if (query.from) builder = builder.gte('marca_tiempo', query.from);
  if (query.to) builder = builder.lte('marca_tiempo', query.to);
  builder = builder.order('marca_tiempo', { ascending: false });
  if (query.limit) builder = builder.limit(query.limit);

  const { data, error } = await builder;
  if (error) {
    console.error('[alert-store] no fue posible listar alertas:', error.message);
    return [];
  }
  return (data as AlertRow[]).map(rowToAlert);
}

export async function updateAlertState(id: AlertId, state: AlertState): Promise<Alert | null> {
  if (!isSupabaseConfigured()) return null;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { estado: state };
  if (state === 'revisada') patch.reconocida_at = now;
  if (state === 'resuelta') patch.resuelta_at = now;

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle<AlertRow>();

  if (error || !data) return null;
  return rowToAlert(data);
}
