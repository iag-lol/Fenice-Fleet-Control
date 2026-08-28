import type { OperationalSettings } from '@/config/operational';
import type {
  DeviceConnectionState,
  IsoDateTime,
  Position,
  VehicleOperationalStatus,
} from '@/types/core';

/**
 * Salud de la telemetria y estado operacional derivado.
 *
 * Un vehiculo "detenido" y uno "offline" son cosas distintas: el primero
 * reporta y no se mueve, el segundo dejo de reportar. Confundirlos hace que la
 * operacion pierda confianza en la plataforma, asi que la distincion vive aqui
 * y no en la UI.
 */

export function secondsSince(iso: IsoDateTime | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((now.getTime() - ms) / 1000));
}

export function evaluateConnectionState(
  lastPositionAt: IsoDateTime | null,
  gps: OperationalSettings['gps'],
  now: Date = new Date(),
): { state: DeviceConnectionState; secondsSinceLastPosition: number | null } {
  const elapsed = secondsSince(lastPositionAt, now);

  if (elapsed === null) {
    return { state: 'unknown', secondsSinceLastPosition: null };
  }
  if (elapsed >= gps.offlineSeconds) {
    return { state: 'offline', secondsSinceLastPosition: elapsed };
  }
  if (elapsed >= gps.signalLostSeconds) {
    return { state: 'lost', secondsSinceLastPosition: elapsed };
  }
  if (elapsed >= gps.staleSeconds) {
    return { state: 'stale', secondsSinceLastPosition: elapsed };
  }
  return { state: 'online', secondsSinceLastPosition: elapsed };
}

export const CONNECTION_LABEL: Record<DeviceConnectionState, string> = {
  online: 'Senal activa',
  stale: 'Senal retrasada',
  lost: 'Posible perdida de senal',
  offline: 'Sin senal',
  unknown: 'Sin datos',
};

export const CONNECTION_COLOR: Record<DeviceConnectionState, string> = {
  online: '#15803d',
  stale: '#b45309',
  lost: '#c2410c',
  offline: '#dc2626',
  unknown: '#64748b',
};

export interface VehicleStatusInput {
  position: Position | null;
  connection: DeviceConnectionState;
  gps: OperationalSettings['gps'];
  /** Vehiculo marcado como fuera de servicio en la ficha de flota. */
  inMaintenance?: boolean;
  /** Tiene una ruta u OT en ejecucion. */
  hasActiveAssignment?: boolean;
}

/**
 * Deriva el estado operacional mostrado en toda la aplicacion.
 *
 * Prioridad: mantenimiento > offline > movimiento > detenido > inactivo.
 * "Detenido" implica que tiene trabajo asignado; sin asignacion es "inactivo",
 * lo que evita inflar el KPI de detenidos con vehiculos en base.
 */
export function deriveVehicleStatus(input: VehicleStatusInput): VehicleOperationalStatus {
  if (input.inMaintenance) return 'mantenimiento';
  if (input.connection === 'offline' || input.connection === 'unknown' || !input.position) {
    return 'offline';
  }

  const moving =
    input.position.speed > input.gps.movingSpeedThresholdKmh && input.position.ignition !== 'off';

  if (moving) return 'en_ruta';
  return input.hasActiveAssignment ? 'detenido' : 'inactivo';
}

export const VEHICLE_STATUS_LABEL: Record<VehicleOperationalStatus, string> = {
  en_ruta: 'En ruta',
  detenido: 'Detenido',
  inactivo: 'Inactivo',
  offline: 'Offline',
  mantenimiento: 'Mantenimiento',
};

export const VEHICLE_STATUS_COLOR: Record<VehicleOperationalStatus, string> = {
  en_ruta: '#0e7490',
  detenido: '#b45309',
  inactivo: '#64748b',
  offline: '#dc2626',
  mantenimiento: '#7e22ce',
};

/**
 * Normaliza una posicion cruda de cualquier proveedor.
 * Descarta coordenadas imposibles y acota valores fuera de rango en vez de
 * propagarlos al mapa.
 */
export function normalizePosition(raw: {
  vehicleId: string;
  deviceId: string;
  timestamp: string;
  receivedAt?: string;
  lat: unknown;
  lng: unknown;
  speed?: unknown;
  heading?: unknown;
  altitude?: unknown;
  accuracy?: unknown;
  ignition?: unknown;
  odometerKm?: unknown;
  batteryLevel?: unknown;
  address?: unknown;
  communeCode?: unknown;
  valid?: unknown;
}): Position | null {
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;

  const timestamp = new Date(raw.timestamp);
  if (Number.isNaN(timestamp.getTime())) return null;

  const speedRaw = Number(raw.speed);
  const headingRaw = Number(raw.heading);

  const ignition =
    raw.ignition === true || raw.ignition === 'on'
      ? 'on'
      : raw.ignition === false || raw.ignition === 'off'
        ? 'off'
        : 'unknown';

  return {
    vehicleId: raw.vehicleId as Position['vehicleId'],
    deviceId: raw.deviceId as Position['deviceId'],
    timestamp: timestamp.toISOString(),
    receivedAt: raw.receivedAt,
    lat,
    lng,
    speed: Number.isFinite(speedRaw) ? Math.max(0, Math.min(200, speedRaw)) : 0,
    heading: Number.isFinite(headingRaw) ? ((headingRaw % 360) + 360) % 360 : 0,
    altitude: Number.isFinite(Number(raw.altitude)) ? Number(raw.altitude) : undefined,
    accuracy: Number.isFinite(Number(raw.accuracy)) ? Number(raw.accuracy) : undefined,
    ignition,
    odometerKm: Number.isFinite(Number(raw.odometerKm)) ? Number(raw.odometerKm) : undefined,
    batteryLevel: Number.isFinite(Number(raw.batteryLevel))
      ? Math.max(0, Math.min(100, Number(raw.batteryLevel)))
      : undefined,
    address: typeof raw.address === 'string' ? raw.address : undefined,
    communeCode: typeof raw.communeCode === 'string' ? raw.communeCode : undefined,
    valid: raw.valid === undefined ? true : Boolean(raw.valid),
  };
}
