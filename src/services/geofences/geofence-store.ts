import 'server-only';

import { z } from 'zod';

import { getDemoDataset } from '@/demo';
import { getOperationalSettings } from '@/services/settings/settings-store';
import {
  asGeofenceId,
  DEFAULT_GEOFENCE_RULES,
  type Geofence,
  type GeofenceId,
} from '@/types/core';

/**
 * Almacen de geocercas.
 *
 * Las geocercas son un artefacto de ESTA plataforma, no de la base de Fenice:
 * por eso admiten escritura sin violar el contrato de solo lectura sobre la
 * fuente externa.
 *
 * Persistencia actual: memoria del proceso, sembrada desde el dataset de
 * demostracion. Al conectar la base interna (`DATABASE_URL`) solo cambian
 * `load` y `persist`; la interfaz y el motor no se enteran.
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

const globalForGeofences = globalThis as unknown as {
  __feniceGeofences?: Map<string, Geofence>;
};

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

function store(): Map<string, Geofence> {
  if (!globalForGeofences.__feniceGeofences) {
    const seeded = new Map<string, Geofence>();
    for (const geofence of getDemoDataset().geofences) seeded.set(geofence.id, geofence);
    globalForGeofences.__feniceGeofences = seeded;
  }
  return globalForGeofences.__feniceGeofences;
}

export function listGeofences(): Geofence[] {
  return [...store().values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function getGeofence(id: GeofenceId): Geofence | null {
  return store().get(id) ?? null;
}

let counter = 0;

function nextId(): GeofenceId {
  counter += 1;
  return asGeofenceId(`gf-man-${Date.now().toString(36)}-${counter}`);
}

export function createGeofence(input: GeofenceInput): Geofence {
  const settings = getOperationalSettings();
  const rules = input.rules ?? {
    ...DEFAULT_GEOFENCE_RULES,
    minDwellSeconds: settings.geofence.minDwellSeconds,
  };

  const geofence: Geofence = {
    id: nextId(),
    name: input.name,
    description: input.description ?? null,
    kind: input.kind,
    geometry: input.geometry,
    referenceId: input.clientId ?? null,
    clientId: (input.clientId ?? null) as Geofence['clientId'],
    routeId: (input.routeId ?? null) as Geofence['routeId'],
    vehicleId: (input.vehicleId ?? null) as Geofence['vehicleId'],
    communeCode: input.communeCode ?? null,
    // El motor de geocercas lee este campo; se mantiene sincronizado con las
    // reglas para que no existan dos verdades sobre la misma permanencia.
    minDwellSeconds: rules.minDwellSeconds,
    rules,
    active: input.active ?? true,
    color: input.color ?? KIND_COLOR[input.kind],
    createdAt: new Date().toISOString(),
    updatedAt: null,
    origin: 'manual',
  };

  store().set(geofence.id, geofence);
  return geofence;
}

export function updateGeofence(id: GeofenceId, input: Partial<GeofenceInput>): Geofence | null {
  const existing = store().get(id);
  if (!existing) return null;

  const rules = input.rules ?? existing.rules;

  const updated: Geofence = {
    ...existing,
    name: input.name ?? existing.name,
    description: input.description === undefined ? existing.description : input.description,
    kind: input.kind ?? existing.kind,
    geometry: input.geometry ?? existing.geometry,
    clientId: (input.clientId === undefined
      ? existing.clientId
      : input.clientId) as Geofence['clientId'],
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

  store().set(id, updated);
  return updated;
}

export function deleteGeofence(id: GeofenceId): boolean {
  return store().delete(id);
}

/**
 * Duplica una geocerca.
 *
 * Util para replicar un perimetro de entrega en varias sucursales del mismo
 * cliente sin volver a dibujarlo.
 */
export function duplicateGeofence(id: GeofenceId): Geofence | null {
  const existing = store().get(id);
  if (!existing) return null;

  const copy: Geofence = {
    ...existing,
    id: nextId(),
    name: `${existing.name} (copia)`,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    origin: 'manual',
  };

  store().set(copy.id, copy);
  return copy;
}
