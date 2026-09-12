import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getDemoDataset } from '@/demo';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { asDeviceId, asDriverId, asVehicleId, type GpsDevice, type Vehicle, type VehicleId } from '@/types/core';

/**
 * Flota (camiones). Artefacto propio de la plataforma: vive en Supabase
 * (tablas `vehiculos` + `dispositivos_gps`) cuando esta configurado, y en
 * memoria (sembrada desde el dataset de demostracion) si no. Ya NO viene del
 * ERP de Fenice: solo clientes, pedidos y ordenes de trabajo siguen ahi.
 */

const TABLE = 'vehiculos';

export const VEHICLE_TYPES = ['cisterna_semirremolque', 'cisterna_rigido', 'camioneta_estanque'] as const;

export const vehicleInputSchema = z.object({
  plate: z
    .string()
    .trim()
    .min(5)
    .max(10)
    .transform((v) => v.toUpperCase().replace(/\s+/g, '')),
  fleetCode: z.string().trim().min(1).max(20),
  brand: z.string().trim().max(60).default(''),
  model: z.string().trim().max(60).default(''),
  year: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1).nullable().optional(),
  type: z.enum(VEHICLE_TYPES),
  /** El operador lo ingresa en metros cubicos; se guarda en litros (x1000). */
  capacityM3: z.coerce.number().positive().max(60),
  compartments: z.coerce.number().int().positive().max(10).default(1),
  depotName: z.string().trim().max(120).default(''),
  active: z.boolean().default(true),
});

export type VehicleInput = z.infer<typeof vehicleInputSchema>;

interface DeviceRow {
  id: string;
  imei: string;
  modelo: string;
  sim_numero: string | null;
  proveedor_id_externo: string | null;
  instalado_at: string | null;
  proveedor: 'traccar' | '3dtracking' | null;
  servidor_url: string | null;
}

interface VehicleRow {
  id: string;
  patente: string;
  codigo_flota: string;
  marca: string;
  modelo: string;
  anio: number | null;
  tipo: Vehicle['type'];
  capacidad_litros: number;
  compartimentos: number;
  conductor_id: string | null;
  base_despacho: string | null;
  activo: boolean;
  dispositivos_gps: DeviceRow | DeviceRow[] | null;
}

function rowToDevice(row: DeviceRow): GpsDevice {
  return {
    id: asDeviceId(row.id),
    imei: row.imei,
    model: row.modelo,
    simNumber: row.sim_numero ?? undefined,
    externalId: row.proveedor_id_externo ?? undefined,
    installedAt: row.instalado_at ?? undefined,
    provider: row.proveedor ?? undefined,
    serverUrl: row.servidor_url ?? undefined,
  };
}

function rowToVehicle(row: VehicleRow): Vehicle {
  const deviceRow = Array.isArray(row.dispositivos_gps) ? row.dispositivos_gps[0] : row.dispositivos_gps;

  return {
    id: asVehicleId(row.id),
    plate: row.patente,
    fleetCode: row.codigo_flota,
    brand: row.marca,
    model: row.modelo,
    year: row.anio ?? new Date().getFullYear(),
    type: row.tipo,
    capacityLiters: row.capacidad_litros,
    compartments: row.compartimentos,
    device: deviceRow ? rowToDevice(deviceRow) : null,
    driverId: row.conductor_id ? asDriverId(row.conductor_id) : null,
    depotName: row.base_despacho ?? '',
    active: row.activo,
  };
}

function inputToRow(input: VehicleInput) {
  return {
    patente: input.plate,
    codigo_flota: input.fleetCode,
    marca: input.brand,
    modelo: input.model,
    anio: input.year ?? null,
    tipo: input.type,
    capacidad_litros: Math.round(input.capacityM3 * 1000),
    compartimentos: input.compartments,
    base_despacho: input.depotName || null,
    activo: input.active,
  };
}

// ---------------------------------------------------------------------------
// Backend en memoria (modo demostracion, sin Supabase configurado)
// ---------------------------------------------------------------------------

const globalForVehicles = globalThis as unknown as {
  __feniceVehicles?: Map<string, Vehicle>;
};

function memoryStore(): Map<string, Vehicle> {
  if (!globalForVehicles.__feniceVehicles) {
    const seeded = new Map<string, Vehicle>();
    for (const vehicle of getDemoDataset().vehicles) seeded.set(vehicle.id, vehicle);
    globalForVehicles.__feniceVehicles = seeded;
  }
  return globalForVehicles.__feniceVehicles;
}

function createInMemory(input: VehicleInput): Vehicle {
  const vehicle: Vehicle = {
    id: asVehicleId(randomUUID()),
    plate: input.plate,
    fleetCode: input.fleetCode,
    brand: input.brand,
    model: input.model,
    year: input.year ?? new Date().getFullYear(),
    type: input.type,
    capacityLiters: Math.round(input.capacityM3 * 1000),
    compartments: input.compartments,
    device: null,
    driverId: null,
    depotName: input.depotName,
    active: input.active,
  };
  memoryStore().set(vehicle.id, vehicle);
  return vehicle;
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

export async function listVehicles(): Promise<Vehicle[]> {
  if (!isSupabaseConfigured()) {
    return [...memoryStore().values()].sort((a, b) => a.fleetCode.localeCompare(b.fleetCode, 'es'));
  }

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*, dispositivos_gps(*)')
    .order('codigo_flota');

  if (error) {
    console.error('[vehicle-store] no fue posible listar la flota:', error.message);
    return [];
  }
  return (data as VehicleRow[]).map(rowToVehicle);
}

export async function getVehicleByIdFromStore(id: VehicleId): Promise<Vehicle | null> {
  if (!isSupabaseConfigured()) return memoryStore().get(id) ?? null;

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*, dispositivos_gps(*)')
    .eq('id', id)
    .maybeSingle<VehicleRow>();

  if (error || !data) return null;
  return rowToVehicle(data);
}

export interface CreateVehicleResult {
  ok: boolean;
  vehicle?: Vehicle;
  error?: string;
}

/** Crea un vehiculo. La patente es unica: dos altas con la misma fallan con un mensaje claro. */
export async function createVehicle(input: VehicleInput): Promise<CreateVehicleResult> {
  if (!isSupabaseConfigured()) return { ok: true, vehicle: createInMemory(input) };

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .insert(inputToRow(input))
    .select('*, dispositivos_gps(*)')
    .single<VehicleRow>();

  if (error) {
    if (error.code === '23505') {
      return { ok: false, error: `Ya existe un vehiculo con la patente ${input.plate} o el codigo ${input.fleetCode}.` };
    }
    return { ok: false, error: `No fue posible crear el vehiculo: ${error.message}` };
  }
  if (!data) return { ok: false, error: 'No fue posible crear el vehiculo.' };

  return { ok: true, vehicle: rowToVehicle(data) };
}

export async function deleteVehicleFromStore(id: VehicleId): Promise<boolean> {
  if (!isSupabaseConfigured()) return memoryStore().delete(id);

  const { error, count } = await getSupabaseClient().from(TABLE).delete({ count: 'exact' }).eq('id', id);
  return !error && (count ?? 0) > 0;
}

/**
 * Actualiza el dispositivo GPS de un vehiculo cuando la flota vive en memoria
 * (sin Supabase configurado). Usado por "Conectar GPS": en modo Supabase esa
 * asociacion se resuelve directamente sobre `dispositivos_gps`/`vehiculos`,
 * pero en memoria no existe esa tabla, asi que el vinculo se escribe aqui,
 * sobre el mismo objeto que `listVehicles()` devuelve.
 */
export function setVehicleDeviceInMemory(id: VehicleId, device: GpsDevice | null): boolean {
  if (isSupabaseConfigured()) return false;
  const vehicle = memoryStore().get(id);
  if (!vehicle) return false;
  memoryStore().set(id, { ...vehicle, device });
  return true;
}
