import 'server-only';

import { z } from 'zod';

import { getDemoDataset } from '@/demo';
import { getOperationalSettings } from '@/services/settings/settings-store';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import {
  asGeofenceId,
  DEFAULT_GEOFENCE_RULES,
  type Geofence,
  type GeofenceId,
} from '@/types/core';

/**
 * Almacen de geocercas ("ubicaciones").
 *
 * Las geocercas son un artefacto de ESTA plataforma, no de la base de Fenice:
 * por eso admiten escritura sin violar el contrato de solo lectura sobre la
 * fuente externa.
 *
 * Persistencia: Supabase (tabla `geocercas`) cuando `FLEET_DATA_PROVIDER` o
 * las credenciales estan configuradas; si no, memoria del proceso sembrada
 * desde el dataset de demostracion, exactamente como antes. La interfaz
 * exportada es identica en ambos casos: nada mas en la aplicacion sabe cual
 * de los dos backends esta activo.
 */

const latLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const geometrySchema = z.discriminatedUnion('shape', [
  z.object({
    shape: z.literal('circle'),
    center: latLngSchema,
    radiusMeters: z.number().min(10).max(50_000),
  }),
  z.object({
    shape: z.literal('polygon'),
    // Tres vertices es el minimo que define un area.
    vertices: z.array(latLngSchema).min(3),
  }),
]);

const rulesSchema = z.object({
  triggers: z.array(
    z.enum([
      'entrada',
      'salida',
      'permanencia',
      'detencion',
      'exceso_tiempo',
      'entrada_fuera_horario',
      'salida_fuera_horario',
      'vehiculo_no_autorizado',
      'entrega_detectada',
      'paso_por_cliente',
    ]),
  ),
  minDwellSeconds: z.number().min(0).max(86_400).nullable(),
  maxDwellSeconds: z.number().min(0).max(86_400).nullable(),
  allowedFrom: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  allowedTo: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  allowedVehicleIds: z.array(z.string()),
  severity: z.enum(['info', 'warning', 'critical']),
});

export const geofenceInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  kind: z.enum([
    'cliente',
    'centro_operacional',
    'zona_autorizada',
    'zona_restringida',
    'comuna',
    'ruta',
    'carga',
    'descarga',
    'personalizada',
  ]),
  geometry: geometrySchema,
  clientId: z.string().nullable().optional(),
  routeId: z.string().nullable().optional(),
  vehicleId: z.string().nullable().optional(),
  communeCode: z.string().nullable().optional(),
  rules: rulesSchema.optional(),
  active: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export type GeofenceInput = z.infer<typeof geofenceInputSchema>;

/** Color por defecto segun el proposito de la geocerca. */
const KIND_COLOR: Record<Geofence['kind'], string> = {
  cliente: '#0d90ae',
  centro_operacional: '#0e7490',
  carga: '#0e7490',
  descarga: '#15803d',
  zona_autorizada: '#15803d',
  zona_restringida: '#dc2626',
  comuna: '#5b6a7e',
  ruta: '#b45309',
  personalizada: '#7e22ce',
};

const TABLE = 'geocercas';

// ---------------------------------------------------------------------------
// Backend en memoria (modo demostracion, sin Supabase configurado)
// ---------------------------------------------------------------------------

const globalForGeofences = globalThis as unknown as {
  __feniceGeofences?: Map<string, Geofence>;
  __feniceGeofenceCounter?: number;
};

function memoryStore(): Map<string, Geofence> {
  if (!globalForGeofences.__feniceGeofences) {
    const seeded = new Map<string, Geofence>();
    for (const geofence of getDemoDataset().geofences) seeded.set(geofence.id, geofence);
    globalForGeofences.__feniceGeofences = seeded;
  }
  return globalForGeofences.__feniceGeofences;
}

function nextMemoryId(): GeofenceId {
  globalForGeofences.__feniceGeofenceCounter = (globalForGeofences.__feniceGeofenceCounter ?? 0) + 1;
  return asGeofenceId(`gf-man-${Date.now().toString(36)}-${globalForGeofences.__feniceGeofenceCounter}`);
}

function buildRules(input: Pick<GeofenceInput, 'rules'>): Geofence['rules'] {
  if (input.rules) return input.rules;
  const settings = getOperationalSettings();
  return { ...DEFAULT_GEOFENCE_RULES, minDwellSeconds: settings.geofence.minDwellSeconds };
}

function createInMemory(input: GeofenceInput): Geofence {
  const rules = buildRules(input);

  const geofence: Geofence = {
    id: nextMemoryId(),
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    geometry: input.geometry,
    referenceId: input.clientId ?? null,
    clientId: (input.clientId ?? null) as Geofence['clientId'],
    routeId: (input.routeId ?? null) as Geofence['routeId'],
    vehicleId: (input.vehicleId ?? null) as Geofence['vehicleId'],
    communeCode: input.communeCode ?? null,
    minDwellSeconds: rules.minDwellSeconds,
    rules,
    active: input.active ?? true,
    color: input.color ?? KIND_COLOR[input.kind],
    createdAt: new Date().toISOString(),
    updatedAt: null,
    origin: 'manual',
  };

  memoryStore().set(geofence.id, geofence);
  return geofence;
}

function updateInMemory(id: GeofenceId, input: Partial<GeofenceInput>): Geofence | null {
  const existing = memoryStore().get(id);
  if (!existing) return null;

  const rules = input.rules ?? existing.rules;

  const updated: Geofence = {
    ...existing,
    name: input.name ?? existing.name,
    description: input.description === undefined ? existing.description : input.description,
    kind: input.kind ?? existing.kind,
    geometry: input.geometry ?? existing.geometry,
    clientId: (input.clientId === undefined ? existing.clientId : input.clientId) as Geofence['clientId'],
    routeId: (input.routeId === undefined ? existing.routeId : input.routeId) as Geofence['routeId'],
    vehicleId: (input.vehicleId === undefined
      ? existing.vehicleId
      : input.vehicleId) as Geofence['vehicleId'],
    communeCode: input.communeCode === undefined ? existing.communeCode : input.communeCode,
    minDwellSeconds: rules.minDwellSeconds,
    rules,
    active: input.active ?? existing.active,
    color: input.color ?? existing.color,
    updatedAt: new Date().toISOString(),
  };

  memoryStore().set(id, updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Backend Supabase
// ---------------------------------------------------------------------------

interface GeofenceRow {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: Geofence['kind'];
  geometria: Geofence['geometry'];
  referencia_id: string | null;
  cliente_id: string | null;
  ruta_id: string | null;
  vehiculo_id: string | null;
  comuna_codigo: string | null;
  permanencia_min_segundos: number | null;
  reglas: Geofence['rules'];
  activo: boolean;
  color: string;
  origen: Geofence['origin'];
  creado_at: string;
  actualizado_at: string | null;
}

function rowToGeofence(row: GeofenceRow): Geofence {
  return {
    id: asGeofenceId(row.id),
    name: row.nombre,
    description: row.descripcion,
    kind: row.tipo,
    geometry: row.geometria,
    referenceId: row.referencia_id,
    clientId: row.cliente_id as Geofence['clientId'],
    routeId: row.ruta_id as Geofence['routeId'],
    vehicleId: row.vehiculo_id as Geofence['vehicleId'],
    communeCode: row.comuna_codigo,
    minDwellSeconds: row.permanencia_min_segundos,
    rules: row.reglas,
    active: row.activo,
    color: row.color,
    createdAt: row.creado_at,
    updatedAt: row.actualizado_at,
    origin: row.origen,
  };
}

function geofenceInputToRow(input: GeofenceInput, rules: Geofence['rules']) {
  return {
    nombre: input.name,
    descripcion: input.description ?? null,
    tipo: input.kind,
    geometria: input.geometry,
    referencia_id: input.clientId ?? null,
    cliente_id: input.clientId ?? null,
    ruta_id: input.routeId ?? null,
    vehiculo_id: input.vehicleId ?? null,
    comuna_codigo: input.communeCode ?? null,
    permanencia_min_segundos: rules.minDwellSeconds,
    reglas: rules,
    activo: input.active ?? true,
    color: input.color ?? KIND_COLOR[input.kind],
  };
}

async function listFromSupabase(): Promise<Geofence[]> {
  const { data, error } = await getSupabaseClient().from(TABLE).select('*').order('nombre');
  if (error) {
    console.error('[geofence-store] no fue posible listar geocercas:', error.message);
    return [];
  }
  return (data as GeofenceRow[]).map(rowToGeofence);
}

async function getFromSupabase(id: GeofenceId): Promise<Geofence | null> {
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle<GeofenceRow>();
  if (error || !data) return null;
  return rowToGeofence(data);
}

async function createInSupabase(input: GeofenceInput): Promise<Geofence> {
  const rules = buildRules(input);
  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .insert({ ...geofenceInputToRow(input, rules), origen: 'manual' })
    .select('*')
    .single<GeofenceRow>();

  if (error || !data) {
    throw new Error(`No fue posible crear la geocerca: ${error?.message ?? 'sin respuesta'}`);
  }
  return rowToGeofence(data);
}

async function updateInSupabase(id: GeofenceId, input: Partial<GeofenceInput>): Promise<Geofence | null> {
  const existing = await getFromSupabase(id);
  if (!existing) return null;

  const rules = input.rules ?? existing.rules;
  const patch: Record<string, unknown> = { reglas: rules, permanencia_min_segundos: rules.minDwellSeconds };

  if (input.name !== undefined) patch.nombre = input.name;
  if (input.description !== undefined) patch.descripcion = input.description;
  if (input.kind !== undefined) patch.tipo = input.kind;
  if (input.geometry !== undefined) patch.geometria = input.geometry;
  if (input.clientId !== undefined) patch.cliente_id = input.clientId;
  if (input.routeId !== undefined) patch.ruta_id = input.routeId;
  if (input.vehicleId !== undefined) patch.vehiculo_id = input.vehicleId;
  if (input.communeCode !== undefined) patch.comuna_codigo = input.communeCode;
  if (input.active !== undefined) patch.activo = input.active;
  if (input.color !== undefined) patch.color = input.color;

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle<GeofenceRow>();

  if (error || !data) return null;
  return rowToGeofence(data);
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

export async function listGeofences(): Promise<Geofence[]> {
  if (isSupabaseConfigured()) return listFromSupabase();
  return [...memoryStore().values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export async function getGeofence(id: GeofenceId): Promise<Geofence | null> {
  if (isSupabaseConfigured()) return getFromSupabase(id);
  return memoryStore().get(id) ?? null;
}

export async function createGeofence(input: GeofenceInput): Promise<Geofence> {
  if (isSupabaseConfigured()) return createInSupabase(input);
  return createInMemory(input);
}

export async function updateGeofence(
  id: GeofenceId,
  input: Partial<GeofenceInput>,
): Promise<Geofence | null> {
  if (isSupabaseConfigured()) return updateInSupabase(id, input);
  return updateInMemory(id, input);
}

export async function deleteGeofence(id: GeofenceId): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const { error, count } = await getSupabaseClient()
      .from(TABLE)
      .delete({ count: 'exact' })
      .eq('id', id);
    return !error && (count ?? 0) > 0;
  }
  return memoryStore().delete(id);
}

/**
 * Duplica una geocerca.
 *
 * Util para replicar un perimetro de entrega en varias sucursales del mismo
 * cliente sin volver a dibujarlo.
 */
export async function duplicateGeofence(id: GeofenceId): Promise<Geofence | null> {
  const existing = await getGeofence(id);
  if (!existing) return null;

  const input: GeofenceInput = {
    name: `${existing.name} (copia)`,
    description: existing.description,
    kind: existing.kind,
    geometry: existing.geometry,
    clientId: existing.clientId,
    routeId: existing.routeId,
    vehicleId: existing.vehicleId,
    communeCode: existing.communeCode,
    rules: existing.rules,
    active: existing.active,
    color: existing.color,
  };

  return createGeofence(input);
}
