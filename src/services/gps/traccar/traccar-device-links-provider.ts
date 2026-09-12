import 'server-only';

import { getServerEnv } from '@/config/env';
import { listVehicles } from '@/services/fleet/vehicle-store';
import type { GpsProvider, PositionSubscriptionHandlers, Unsubscribe } from '@/services/gps/gps-provider';
import { buildTraccarAuthHeader, TraccarClient } from '@/services/gps/traccar/traccar-client';
import { buildDeviceIndex, mapTraccarPosition, type DeviceVehicleLink } from '@/services/gps/traccar/traccar-mapper';
import type { DeviceStatus, Position, Vehicle, VehicleId } from '@/types/core';

/**
 * Posiciones de vehiculos conectados a Traccar desde "Conectar GPS" (ficha del
 * vehiculo), superpuestas al proveedor GPS que sea que `GPS_PROVIDER` tenga
 * elegido para el resto de la flota.
 *
 * Existen dos formas de tener telemetria Traccar en esta plataforma:
 *
 *  1. `GPS_PROVIDER=traccar`: TODA la flota viene de un servidor Traccar
 *     unico (`TraccarGpsProvider`), vinculada por `dispositivos_gps` que ya
 *     existia antes de esta funcionalidad.
 *  2. Este modulo: UN VEHICULO CONCRETO se asocia a un dispositivo Traccar
 *     desde su ficha, sin tocar `GPS_PROVIDER` ni redeployar. Es el camino
 *     pensado para "probar con mi telefono" o para incorporar equipos de a
 *     uno sin migrar toda la flota de golpe.
 *
 * Ambos pueden convivir: si un vehiculo ya trae posicion del proveedor base,
 * esta capa no la reemplaza. Se activa sola en cuanto existe al menos un
 * vehiculo con un dispositivo Traccar asociado; sin ninguno, es un no-op.
 */

const POLL_INTERVAL_MS = 3_000;
/** Vida del cache de posiciones: evita golpear Traccar una vez por cada pestana con el mapa abierto. */
const POSITIONS_CACHE_MS = 2_000;

interface LinkedGroup {
  serverUrl: string;
  client: TraccarClient;
  links: DeviceVehicleLink[];
}

async function resolveLinkedGroups(): Promise<LinkedGroup[]> {
  const vehicles = await listVehicles();
  const env = getServerEnv();
  const defaultAuth = buildTraccarAuthHeader({
    token: env.TRACCAR_TOKEN,
    username: env.TRACCAR_USERNAME,
    password: env.TRACCAR_PASSWORD,
  });

  const byServer = new Map<string, DeviceVehicleLink[]>();

  for (const vehicle of vehicles) {
    const device = vehicle.device;
    if (!device || device.provider !== 'traccar' || !device.externalId) continue;

    const traccarDeviceId = Number(device.externalId);
    if (!Number.isFinite(traccarDeviceId)) continue;

    const serverUrl = device.serverUrl || env.TRACCAR_BASE_URL;
    if (!serverUrl) continue;

    const link: DeviceVehicleLink = {
      traccarDeviceId,
      imei: device.imei,
      vehicleId: vehicle.id,
      internalDeviceId: device.id,
    };
    const existing = byServer.get(serverUrl);
    if (existing) existing.push(link);
    else byServer.set(serverUrl, [link]);
  }

  return [...byServer.entries()].map(([serverUrl, links]) => ({
    serverUrl,
    // Servidores distintos al configurado comparten igual las mismas
    // credenciales (ver `vehicle-gps-device.ts`): es la limitacion aceptada
    // de esta primera version, documentada ahi mismo.
    client: new TraccarClient({ baseUrl: serverUrl, authHeader: defaultAuth }),
    links,
  }));
}

let positionsCache: { positions: Position[]; expiresAt: number } | null = null;
let inFlight: Promise<Position[]> | null = null;

async function fetchLinkedPositions(): Promise<Position[]> {
  if (positionsCache && positionsCache.expiresAt > Date.now()) return positionsCache.positions;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const groups = await resolveLinkedGroups();
    if (groups.length === 0) return [];

    const perGroup = await Promise.all(
      groups.map(async (group) => {
        const index = buildDeviceIndex(group.links);
        try {
          const raw = await group.client.getPositions();
          return raw
            .map((p) => {
              const link = index.get(p.deviceId);
              return link ? mapTraccarPosition(p, link) : null;
            })
            .filter((p): p is Position => p !== null);
        } catch (error) {
          console.error(
            `[traccar-device-links] no fue posible obtener posiciones de ${group.serverUrl}:`,
            error instanceof Error ? error.message : String(error),
          );
          return [];
        }
      }),
    );

    return perGroup.flat();
  })();

  try {
    const positions = await inFlight;
    positionsCache = { positions, expiresAt: Date.now() + POSITIONS_CACHE_MS };
    return positions;
  } finally {
    inFlight = null;
  }
}

function mergeByVehicle<T extends { vehicleId: VehicleId }>(base: T[], extra: T[]): T[] {
  const covered = new Set(base.map((item) => item.vehicleId));
  return [...base, ...extra.filter((item) => !covered.has(item.vehicleId))];
}

export function withTraccarDeviceLinks(base: GpsProvider): GpsProvider {
  return {
    info: base.info,

    async getVehicles(): Promise<Vehicle[]> {
      return base.getVehicles();
    },

    async getVehiclePosition(vehicleId) {
      const basePosition = await base.getVehiclePosition(vehicleId);
      if (basePosition) return basePosition;
      const linked = await fetchLinkedPositions();
      return linked.find((p) => p.vehicleId === vehicleId) ?? null;
    },

    async getAllCurrentPositions(): Promise<Position[]> {
      const [basePositions, linkedPositions] = await Promise.all([
        base.getAllCurrentPositions().catch(() => []),
        fetchLinkedPositions().catch(() => []),
      ]);
      return mergeByVehicle(basePositions, linkedPositions);
    },

    getPositionHistory: (query) => base.getPositionHistory(query),
    getVehicleEvents: (query) => base.getVehicleEvents(query),

    async getDeviceStatus(vehicleId): Promise<DeviceStatus[]> {
      const baseStatuses = await base.getDeviceStatus(vehicleId).catch(() => []);
      if (vehicleId && baseStatuses.length > 0) return baseStatuses;

      const [groups, positions] = await Promise.all([resolveLinkedGroups(), fetchLinkedPositions()]);
      const now = new Date();
      const linkedStatuses: DeviceStatus[] = [];

      for (const group of groups) {
        for (const link of group.links) {
          if (vehicleId && link.vehicleId !== vehicleId) continue;
          const position = positions.find((p) => p.vehicleId === link.vehicleId);
          linkedStatuses.push({
            deviceId: link.internalDeviceId as DeviceStatus['deviceId'],
            vehicleId: link.vehicleId,
            imei: link.imei,
            connection: position ? 'online' : 'unknown',
            lastPositionAt: position?.timestamp ?? null,
            secondsSinceLastPosition: position
              ? Math.max(0, Math.round((now.getTime() - new Date(position.timestamp).getTime()) / 1000))
              : null,
            protocol: 'traccar',
          });
        }
      }

      return mergeByVehicle(baseStatuses, linkedStatuses);
    },

    subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
      const unsubscribeBase = base.subscribeToPositions(handlers);

      let closed = false;
      const poll = async (): Promise<void> => {
        if (closed) return;
        try {
          const positions = await fetchLinkedPositions();
          if (positions.length > 0) handlers.onPositions(positions);
        } catch {
          // Un fallo puntual de los vinculos Traccar no debe apagar el
          // proveedor base: ya se registro en `fetchLinkedPositions`.
        }
      };

      void poll();
      const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);

      return () => {
        closed = true;
        clearInterval(timer);
        unsubscribeBase();
      };
    },

    healthCheck: base.healthCheck?.bind(base),
  };
}
