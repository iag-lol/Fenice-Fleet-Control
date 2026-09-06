import 'server-only';

import { getDemoDataset } from '@/demo';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { asDriverId, type Driver, type DriverId } from '@/types/core';

/**
 * Conductores. Artefacto propio de la plataforma (tabla `conductores` en
 * Supabase); ya NO viene del ERP de Fenice.
 */

const TABLE = 'conductores';

interface DriverRow {
  id: string;
  nombre_completo: string;
  documento_identidad: string;
  telefono: string;
  clase_licencia: string;
  licencia_vencimiento: string;
  activo: boolean;
}

function rowToDriver(row: DriverRow): Driver {
  return {
    id: asDriverId(row.id),
    fullName: row.nombre_completo,
    documentId: row.documento_identidad,
    phone: row.telefono,
    licenseClass: row.clase_licencia,
    licenseExpiresAt: row.licencia_vencimiento,
    active: row.activo,
  };
}

export async function listDrivers(): Promise<Driver[]> {
  if (!isSupabaseConfigured()) return getDemoDataset().drivers;

  const { data, error } = await getSupabaseClient().from(TABLE).select('*').order('nombre_completo');
  if (error) {
    console.error('[driver-store] no fue posible listar conductores:', error.message);
    return [];
  }
  return (data as DriverRow[]).map(rowToDriver);
}

export async function getDriverByIdFromStore(id: DriverId): Promise<Driver | null> {
  if (!isSupabaseConfigured()) {
    return getDemoDataset().drivers.find((d) => d.id === id) ?? null;
  }

  const { data, error } = await getSupabaseClient()
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle<DriverRow>();

  if (error || !data) return null;
  return rowToDriver(data);
}
