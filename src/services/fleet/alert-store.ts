import 'server-only';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import type { AlertQuery } from '@/services/operations/operations-provider';
import {
  asAlertId,
  asVehicleId,
  asWorkOrderId,
  type Alert,
  type AlertId,
  type AlertState,
  type AlertType,
  type AlertCategory,
  type AlertSeverity,
  type LatLng,
  type VehicleId,
} from '@/types/core';

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

// ---------------------------------------------------------------------------
// Backend en memoria (modo demostracion, sin Supabase configurado)
// ---------------------------------------------------------------------------

const globalForRealAlerts = globalThis as unknown as {
  __feniceRealAlerts?: Map<string, Alert>;
};

function memoryStore(): Map<string, Alert> {
  if (!globalForRealAlerts.__feniceRealAlerts) globalForRealAlerts.__feniceRealAlerts = new Map();
  return globalForRealAlerts.__feniceRealAlerts;
}

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
  if (!isSupabaseConfigured()) {
    let alerts = [...memoryStore().values()];
    if (query.states?.length) {
      const wanted = new Set(query.states);
      alerts = alerts.filter((a) => wanted.has(a.state));
    }
    if (query.from || query.to) {
      const fromMs = query.from ? new Date(query.from).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = query.to ? new Date(query.to).getTime() : Number.POSITIVE_INFINITY;
      alerts = alerts.filter((a) => {
        const ms = new Date(a.timestamp).getTime();
        return ms >= fromMs && ms <= toMs;
      });
    }
    alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return query.limit ? alerts.slice(0, query.limit) : alerts;
  }

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

export interface CreateAlertInput {
  /** Id deterministico (ej. `geocerca-entrada:<geofenceId>:<vehicleId>:<timestamp>`): protege contra duplicados si el mismo evento se evalua mas de una vez. */
  id: string;
  type: AlertType;
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: string;
  vehicleId?: VehicleId | null;
  vehiclePlate?: string | null;
  position?: LatLng | null;
  metadata?: Record<string, string | number> | null;
}

/**
 * Crea una alerta real, generada por el procesamiento de telemetria en vivo
 * (ver `geofence-detector.ts`). El id es deterministico: si el mismo evento
 * se evalua mas de una vez (ej. varias pestañas con el mapa abierto
 * disparando el mismo chequeo), el conflicto de llave primaria evita
 * duplicarla en vez de que haya que deduplicar despues.
 */
export async function createAlert(input: CreateAlertInput): Promise<void> {
  if (!isSupabaseConfigured()) {
    // Mismo espiritu que el upsert real: si el id ya existe, no se duplica.
    if (memoryStore().has(input.id)) return;
    memoryStore().set(input.id, {
      id: asAlertId(input.id),
      type: input.type,
      category: input.category,
      severity: input.severity,
      title: input.title,
      description: input.description,
      timestamp: input.timestamp,
      vehicleId: input.vehicleId ?? null,
      vehiclePlate: input.vehiclePlate ?? null,
      clientId: null,
      clientName: null,
      workOrderId: null,
      workOrderNumber: null,
      position: input.position ?? null,
      state: 'nueva',
      acknowledgedAt: null,
      resolvedAt: null,
      metadata: input.metadata ?? null,
    });
    return;
  }

  const row = {
    id: input.id,
    tipo: input.type,
    categoria: input.category,
    severidad: input.severity,
    titulo: input.title,
    descripcion: input.description,
    marca_tiempo: input.timestamp,
    vehiculo_id: input.vehicleId ?? null,
    vehiculo_patente: input.vehiclePlate ?? null,
    lat: input.position?.lat ?? null,
    lng: input.position?.lng ?? null,
    estado: 'nueva' as const,
    metadata: input.metadata ?? null,
  };

  const { error } = await getSupabaseClient()
    .from(TABLE)
    .upsert(row, { onConflict: 'id', ignoreDuplicates: true });

  if (error) console.error('[alert-store] no fue posible crear la alerta:', error.message);
}

export async function updateAlertState(id: AlertId, state: AlertState): Promise<Alert | null> {
  if (!isSupabaseConfigured()) {
    const existing = memoryStore().get(id);
    if (!existing) return null;
    const now = new Date().toISOString();
    const updated: Alert = {
      ...existing,
      state,
      acknowledgedAt: state === 'revisada' ? now : existing.acknowledgedAt,
      resolvedAt: state === 'resuelta' ? now : existing.resolvedAt,
    };
    memoryStore().set(id, updated);
    return updated;
  }

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
