import 'server-only';

import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { getVehicleByIdFromStore, setVehicleDeviceInMemory } from '@/services/fleet/vehicle-store';
import { buildTraccarAuthHeader, TraccarClient, TraccarRequestError } from '@/services/gps/traccar/traccar-client';
import { asDeviceId, type GpsDevice, type Vehicle, type VehicleId } from '@/types/core';

/**
 * Asociacion "vehiculo <-> dispositivo GPS", gestionada desde la ficha del
 * vehiculo ("Conectar GPS").
 *
 * El operador solo escribe el identificador que Traccar Client (o el equipo
 * Teltonika) reporta como `uniqueId`; el `deviceId` numerico interno de
 * Traccar se resuelve aqui y se cachea en `proveedor_id_externo`. Es el mismo
 * campo que ya lee `TraccarGpsProvider` para vincular telemetria a un
 * vehiculo, asi que conectar un dispositivo aqui es lo unico que hace falta
 * para que aparezca en el mapa en vivo.
 */

export interface VehicleGpsDeviceInfo {
  provider: 'traccar' | '3dtracking';
  /** El "Device Identifier" que el operador escribio (uniqueId / IMEI). */
  identifier: string;
  /** Servidor de ESTE dispositivo. `null` = usa el configurado por defecto (TRACCAR_BASE_URL). */
  serverUrl: string | null;
  /** deviceId numerico de Traccar, ya resuelto. `null` si aun no se ha podido resolver. */
  externalDeviceId: string | null;
  enabled: boolean;
  lastConnectionAt: string | null;
}

export type TraccarProbeStep = 'server' | 'device' | 'position';

export interface TraccarConnectionTest {
  ok: boolean;
  serverReachable: boolean;
  deviceFound: boolean;
  hasPosition: boolean;
  /** Mensaje ya listo para mostrar al operador, sin jerga tecnica. */
  message: string;
  externalDeviceId?: string;
  lastPositionAt?: string | null;
  /** Primer paso que fallo, para que la UI marque exactamente donde se corto. */
  failedStep?: TraccarProbeStep;
}

/** Servidor por defecto: el que ya usa el proveedor GPS global (`TRACCAR_*`). */
function defaultServerCredentials(): { baseUrl: string; authHeader: string | null } | null {
  const env = getServerEnv();
  if (!env.TRACCAR_BASE_URL) return null;
  return {
    baseUrl: env.TRACCAR_BASE_URL,
    authHeader: buildTraccarAuthHeader({
      token: env.TRACCAR_TOKEN,
      username: env.TRACCAR_USERNAME,
      password: env.TRACCAR_PASSWORD,
    }),
  };
}

function resolveClient(serverUrl?: string | null): { client: TraccarClient; usesDefaultAuth: boolean } | null {
  const defaults = defaultServerCredentials();
  const baseUrl = serverUrl?.trim() || defaults?.baseUrl;
  if (!baseUrl) return null;

  // Un servidor distinto al configurado por variable de entorno no tiene
  // credenciales propias en esta primera version: se prueba con las mismas
  // (caso normal: todos los equipos comparten cuenta) y, si el servidor las
  // rechaza o no hay ninguna configurada, el resultado de la prueba lo dice
  // en vez de fallar en silencio.
  const authHeader = defaults?.authHeader ?? null;
  return { client: new TraccarClient({ baseUrl, authHeader }), usesDefaultAuth: true };
}

/**
 * Prueba de extremo a extremo: servidor alcanzable -> dispositivo encontrado
 * -> tiene al menos una posicion. No guarda nada; es lo que respalda el boton
 * "Probar conexion" antes de asociar el dispositivo de verdad.
 */
export async function testTraccarConnection(input: {
  identifier: string;
  serverUrl?: string;
}): Promise<TraccarConnectionTest> {
  const identifier = input.identifier.trim();
  if (!identifier) {
    return {
      ok: false,
      serverReachable: false,
      deviceFound: false,
      hasPosition: false,
      message: 'Ingresa el identificador del dispositivo.',
      failedStep: 'server',
    };
  }

  const resolved = resolveClient(input.serverUrl);
  if (!resolved) {
    return {
      ok: false,
      serverReachable: false,
      deviceFound: false,
      hasPosition: false,
      message:
        'No hay un servidor Traccar configurado. Indica uno, o configura TRACCAR_BASE_URL en el servidor.',
      failedStep: 'server',
    };
  }

  let device;
  try {
    device = await resolved.client.getDeviceByUniqueId(identifier);
  } catch (error) {
    if (error instanceof TraccarRequestError) {
      return {
        ok: false,
        serverReachable: error.reason !== 'network',
        deviceFound: false,
        hasPosition: false,
        message:
          error.reason === 'network'
            ? 'No se pudo conectar al servidor. Revisa la URL e intenta de nuevo.'
            : error.reason === 'auth'
              ? 'Servidor conectado, pero rechazo las credenciales configuradas.'
              : 'El servidor respondio con un error inesperado.',
        failedStep: 'server',
      };
    }
    throw error;
  }

  if (!device) {
    return {
      ok: false,
      serverReachable: true,
      deviceFound: false,
      hasPosition: false,
      message: `Servidor conectado, pero no existe ningun dispositivo con el identificador "${identifier}".`,
      failedStep: 'device',
    };
  }

  const positions = await resolved.client.getPositions(device.id).catch(() => []);
  const hasPosition = positions.length > 0;

  return {
    ok: true,
    serverReachable: true,
    deviceFound: true,
    hasPosition,
    message: hasPosition
      ? 'Servidor conectado, dispositivo encontrado y transmitiendo posicion.'
      : 'Servidor conectado y dispositivo encontrado, pero todavia no reporta ninguna posicion.',
    externalDeviceId: String(device.id),
    lastPositionAt: device.lastUpdate,
    failedStep: hasPosition ? undefined : 'position',
  };
}

// ---------------------------------------------------------------------------
// Persistencia: Supabase (dispositivos_gps + vehiculos.dispositivo_id), con
// respaldo en memoria cuando Supabase no esta configurado.
// ---------------------------------------------------------------------------

/**
 * En modo memoria (sin Supabase) el vinculo se guarda directamente sobre el
 * `Vehicle.device` que ya mantiene `vehicle-store`, para que `listVehicles()`
 * (de donde lee el proveedor GPS) lo vea sin necesitar un segundo almacen
 * que mantener sincronizado.
 */
function deviceInfoFromVehicle(vehicle: Vehicle): VehicleGpsDeviceInfo | null {
  if (!vehicle.device || vehicle.device.provider !== 'traccar') return null;
  return {
    provider: 'traccar',
    identifier: vehicle.device.imei,
    serverUrl: vehicle.device.serverUrl ?? null,
    externalDeviceId: vehicle.device.externalId ?? null,
    enabled: true,
    lastConnectionAt: vehicle.device.installedAt ?? null,
  };
}

export async function getVehicleGpsDevice(vehicleId: VehicleId): Promise<VehicleGpsDeviceInfo | null> {
  if (!isSupabaseConfigured()) {
    const vehicle = await getVehicleByIdFromStore(vehicleId);
    return vehicle ? deviceInfoFromVehicle(vehicle) : null;
  }

  const { data, error } = await getSupabaseClient()
    .from('vehiculos')
    .select('dispositivos_gps(imei, proveedor, servidor_url, proveedor_id_externo, habilitado, ultima_conexion_at)')
    .eq('id', vehicleId)
    .maybeSingle<{
      dispositivos_gps: {
        imei: string;
        proveedor: 'traccar' | '3dtracking';
        servidor_url: string | null;
        proveedor_id_externo: string | null;
        habilitado: boolean;
        ultima_conexion_at: string | null;
      } | null;
    }>();

  if (error || !data?.dispositivos_gps) return null;
  const row = data.dispositivos_gps;
  return {
    provider: row.proveedor,
    identifier: row.imei,
    serverUrl: row.servidor_url,
    externalDeviceId: row.proveedor_id_externo,
    enabled: row.habilitado,
    lastConnectionAt: row.ultima_conexion_at,
  };
}

export interface ConnectVehicleGpsResult {
  ok: boolean;
  error?: string;
  device?: VehicleGpsDeviceInfo;
  test: TraccarConnectionTest;
}

/**
 * Asocia (o reemplaza) el dispositivo Traccar de un vehiculo.
 *
 * Prueba la conexion primero: nunca se guarda un identificador que el
 * servidor no reconoce, para no dejar al vehiculo "conectado" en apariencia
 * sin estarlo de verdad.
 */
export async function connectVehicleTraccarDevice(
  vehicleId: VehicleId,
  input: { identifier: string; serverUrl?: string },
): Promise<ConnectVehicleGpsResult> {
  const identifier = input.identifier.trim();
  const serverUrl = input.serverUrl?.trim() || null;
  const test = await testTraccarConnection({ identifier, serverUrl: serverUrl ?? undefined });

  if (!test.deviceFound) {
    return { ok: false, error: test.message, test };
  }

  const now = new Date().toISOString();

  if (!isSupabaseConfigured()) {
    const vehicle = await getVehicleByIdFromStore(vehicleId);
    if (!vehicle) return { ok: false, error: 'Vehiculo no encontrado.', test };

    const device: GpsDevice = {
      id: vehicle.device?.id ?? asDeviceId(`mem-device-${vehicleId}`),
      imei: identifier,
      model: vehicle.device?.model ?? '',
      provider: 'traccar',
      serverUrl: serverUrl ?? undefined,
      externalId: test.externalDeviceId,
      installedAt: now,
    };
    setVehicleDeviceInMemory(vehicleId, device);
    return { ok: true, device: deviceInfoFromVehicle({ ...vehicle, device })!, test };
  }

  const supabase = getSupabaseClient();

  // Reutiliza el dispositivo ya asociado a este vehiculo si existe (mismo
  // uuid), para no acumular filas huerfanas en `dispositivos_gps` cada vez
  // que se corrige un identificador.
  const { data: vehicleRow } = await supabase
    .from('vehiculos')
    .select('dispositivo_id')
    .eq('id', vehicleId)
    .maybeSingle<{ dispositivo_id: string | null }>();

  const devicePayload = {
    imei: identifier,
    proveedor: 'traccar' as const,
    servidor_url: serverUrl,
    proveedor_id_externo: test.externalDeviceId ?? null,
    habilitado: true,
    ultima_conexion_at: now,
  };

  const { data: deviceRow, error: deviceError } = vehicleRow?.dispositivo_id
    ? await supabase
        .from('dispositivos_gps')
        .update(devicePayload)
        .eq('id', vehicleRow.dispositivo_id)
        .select('id')
        .single<{ id: string }>()
    : await supabase.from('dispositivos_gps').insert(devicePayload).select('id').single<{ id: string }>();

  if (deviceError || !deviceRow) {
    const duplicado = deviceError?.code === '23505';
    return {
      ok: false,
      error: duplicado
        ? `El identificador "${identifier}" ya esta asociado a otro vehiculo.`
        : `No fue posible guardar el dispositivo: ${deviceError?.message ?? 'error desconocido'}.`,
      test,
    };
  }

  const { error: linkError } = await supabase
    .from('vehiculos')
    .update({ dispositivo_id: deviceRow.id })
    .eq('id', vehicleId);

  if (linkError) {
    return { ok: false, error: `No fue posible asociar el dispositivo al vehiculo: ${linkError.message}`, test };
  }

  return {
    ok: true,
    device: {
      provider: 'traccar',
      identifier,
      serverUrl,
      externalDeviceId: test.externalDeviceId ?? null,
      enabled: true,
      lastConnectionAt: now,
    },
    test,
  };
}

/**
 * Desconecta el GPS del vehiculo. Solo rompe el vinculo (`dispositivo_id`):
 * el registro de `dispositivos_gps` se conserva, por si el mismo equipo
 * vuelve a asociarse mas tarde.
 */
export async function disconnectVehicleGpsDevice(vehicleId: VehicleId): Promise<boolean> {
  if (!isSupabaseConfigured()) return setVehicleDeviceInMemory(vehicleId, null);

  const { error } = await getSupabaseClient()
    .from('vehiculos')
    .update({ dispositivo_id: null })
    .eq('id', vehicleId);

  return !error;
}
