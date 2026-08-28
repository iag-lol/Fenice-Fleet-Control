import 'server-only';

import { normalizePosition } from '@/lib/engines/gps-health';
import {
  asDeviceId,
  asVehicleId,
  type DeviceConnectionState,
  type DeviceStatus,
  type GpsEvent,
  type GpsEventType,
  type IsoDateTime,
  type Position,
  type VehicleId,
} from '@/types/core';

/**
 * Traduccion Traccar -> modelo interno.
 *
 * TODO el conocimiento del formato de Traccar vive aqui. Si Traccar cambia sus
 * campos, o si Fenice migra a otra plataforma GPS, este archivo es lo unico
 * que se reescribe.
 *
 * Referencia de la cadena real:
 *   Teltonika FMC130 -> SIM 4G -> servidor Traccar -> esta plataforma.
 */

/** Forma de `GET /api/devices` en Traccar. */
export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string | null;
  positionId?: number;
  model?: string | null;
  contact?: string | null;
  category?: string | null;
  disabled?: boolean;
}

/** Forma de `GET /api/positions`. */
export interface TraccarPosition {
  id: number;
  deviceId: number;
  protocol?: string;
  deviceTime: string;
  fixTime: string;
  serverTime: string;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number; // nudos
  course: number;
  address: string | null;
  accuracy?: number;
  attributes?: Record<string, unknown>;
}

/** Forma de `GET /api/reports/events`. */
export interface TraccarEvent {
  id: number;
  type: string;
  eventTime: string;
  deviceId: number;
  positionId?: number;
  geofenceId?: number;
  attributes?: Record<string, unknown>;
}

const KNOTS_TO_KMH = 1.852;

/**
 * Mapa dispositivo Traccar -> vehiculo de la plataforma.
 *
 * Se resuelve por `GpsDevice.externalId`, que es el campo previsto en el
 * modelo interno justamente para este enlace. Mientras Fenice no entregue la
 * correspondencia definitiva, el `uniqueId` (IMEI) sirve de respaldo.
 */
export interface DeviceVehicleLink {
  traccarDeviceId: number;
  imei: string;
  vehicleId: VehicleId;
  internalDeviceId: string;
}

export function buildDeviceIndex(links: DeviceVehicleLink[]): Map<number, DeviceVehicleLink> {
  return new Map(links.map((link) => [link.traccarDeviceId, link]));
}

function numberAttribute(attributes: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = attributes?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function mapTraccarPosition(
  raw: TraccarPosition,
  link: DeviceVehicleLink,
): Position | null {
  const attributes = raw.attributes ?? {};
  const ignitionRaw = attributes['ignition'];

  return normalizePosition({
    vehicleId: link.vehicleId,
    deviceId: link.internalDeviceId,
    // `fixTime` es el instante del fix GPS; `deviceTime` puede diferir cuando
    // el equipo almacena y reenvia tras un tunel o zona sin cobertura.
    timestamp: raw.fixTime || raw.deviceTime,
    receivedAt: raw.serverTime,
    lat: raw.latitude,
    lng: raw.longitude,
    // Traccar reporta la velocidad en nudos.
    speed: Number(raw.speed) * KNOTS_TO_KMH,
    heading: raw.course,
    altitude: raw.altitude,
    accuracy: raw.accuracy,
    ignition: typeof ignitionRaw === 'boolean' ? ignitionRaw : undefined,
    // El FMC130 expone el odometro total en metros.
    odometerKm: (() => {
      const meters = numberAttribute(attributes, 'totalDistance');
      return meters === undefined ? undefined : meters / 1000;
    })(),
    batteryLevel: numberAttribute(attributes, 'batteryLevel'),
    address: raw.address ?? undefined,
    valid: raw.valid,
  });
}

const EVENT_TYPE_MAP: Record<string, GpsEventType> = {
  deviceOnline: 'device_online',
  deviceOffline: 'device_offline',
  deviceMoving: 'idle_end',
  deviceStopped: 'idle_start',
  deviceOverspeed: 'overspeed',
  ignitionOn: 'ignition_on',
  ignitionOff: 'ignition_off',
  geofenceEnter: 'geofence_enter',
  geofenceExit: 'geofence_exit',
  alarm: 'sos',
  powerCut: 'power_cut',
  hardBraking: 'harsh_braking',
  hardAcceleration: 'harsh_acceleration',
};

export function mapTraccarEvent(
  raw: TraccarEvent,
  link: DeviceVehicleLink,
  position?: { lat: number; lng: number },
): GpsEvent | null {
  const type = EVENT_TYPE_MAP[raw.type];
  // Traccar emite muchos tipos que la operacion de Fenice no usa. Se descartan
  // aqui en vez de propagarlos como ruido al centro de alertas.
  if (!type) return null;

  return {
    id: `traccar-${raw.id}`,
    vehicleId: link.vehicleId,
    deviceId: asDeviceId(link.internalDeviceId),
    type,
    timestamp: new Date(raw.eventTime).toISOString(),
    position,
    geofenceId: raw.geofenceId ? (String(raw.geofenceId) as GpsEvent['geofenceId']) : undefined,
    detail: typeof raw.attributes?.['alarm'] === 'string' ? String(raw.attributes['alarm']) : undefined,
  };
}

export function mapTraccarDeviceStatus(
  raw: TraccarDevice,
  link: DeviceVehicleLink,
  now: Date = new Date(),
): DeviceStatus {
  const lastPositionAt: IsoDateTime | null = raw.lastUpdate
    ? new Date(raw.lastUpdate).toISOString()
    : null;

  const secondsSinceLastPosition = lastPositionAt
    ? Math.max(0, Math.round((now.getTime() - new Date(lastPositionAt).getTime()) / 1000))
    : null;

  // El estado de Traccar es una senal gruesa; la clasificacion fina por
  // antiguedad la aplica `evaluateConnectionState` con los umbrales de Fenice.
  const connection: DeviceConnectionState =
    raw.status === 'online' ? 'online' : raw.status === 'offline' ? 'offline' : 'unknown';

  return {
    deviceId: asDeviceId(link.internalDeviceId),
    vehicleId: asVehicleId(link.vehicleId),
    imei: raw.uniqueId,
    connection,
    lastPositionAt,
    secondsSinceLastPosition,
    protocol: 'teltonika',
    model: raw.model ?? 'Teltonika FMC130',
  };
}
