import 'server-only';

import { getDemoDataset } from '@/demo';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { asDeviceId, asDriverId, asVehicleId, type GpsDevice, type Vehicle, type VehicleId } from '@/types/core';

/**
 * Flota (camiones). Artefacto propio de la plataforma: vive en Supabase
 * (tablas `vehiculos` + `dispositivos_gps`) cuando esta configurado, y en el
 * dataset de demostracion si no. Ya NO viene del ERP de Fenice: solo
 * clientes, pedidos y ordenes de trabajo siguen ahi.
 */

const TABLE = 'vehiculos';

interface DeviceRow {
  id: string;
  imei: string;
  modelo: string;
  sim_numero: string | null;
  proveedor_id_externo: string | null;
  instalado_at: string | null;
}

interface VehicleRow {
  id: string;
  patente: string;
  codigo_flota: string;
  marca: string;
  modelo: string;
  anio: number;
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
    year: row.anio,
    type: row.tipo,
    capacityLiters: row.capacidad_litros,
    compartments: row.compartimentos,
    device: deviceRow ? rowToDevice(deviceRow) : null,
    driverId: row.conductor_id ? asDriverId(row.conductor_id) : null,
    depotName: row.base_despacho ?? '',
    active: row.activo,
  };
}

export async function listVehicles(): Promise<Vehicle[]> {
  if (!isSupabaseConfigured()) return getDemoDataset().vehicles;

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
  if (!isSupabaseConfigured()) {
    return getDemoDataset().vehicles.find((v) => v.id === id) ?? null;
  }

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*, dispositivos_gps(*)')
    .eq('id', id)
    .maybeSingle<VehicleRow>();

  if (error || !data) return null;
  return rowToVehicle(data);
}
