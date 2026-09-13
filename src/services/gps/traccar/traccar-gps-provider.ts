import 'server-only';

import { normalizeGpsHistory } from '@/lib/gps-history';
import { getServerEnv } from '@/config/env';
import { listVehicles } from '@/services/fleet/vehicle-store';
import { GpsProviderError } from '@/services/gps/gps-provider';
import type {
  GpsProvider,
  GpsProviderInfo,
  PositionHistoryQuery,
  PositionSubscriptionHandlers,
  Unsubscribe,
  VehicleEventsQuery,
} from '@/services/gps/gps-provider';
import { buildTraccarAuthHeader, TraccarClient } from '@/services/gps/traccar/traccar-client';
import {
  buildDeviceIndex,
  mapTraccarDeviceStatus,
  mapTraccarEvent,
  mapTraccarPosition,
  type DeviceVehicleLink,
  type TraccarEvent,
  type TraccarPosition,
} from '@/services/gps/traccar/traccar-mapper';
import type { DeviceStatus, GpsEvent, Position, Vehicle, VehicleId } from '@/types/core';

/**
 * Proveedor GPS contra un servidor Traccar real.
 *
 * SEGURIDAD: esta clase solo se instancia en el servidor. Las credenciales
 * viajan en la cabecera de autenticacion desde Node, nunca desde el navegador.
 * El navegador consume `/api/gps/*`, que actua como proxy.
 */
export class TraccarGpsProvider implements GpsProvider {
  readonly info: GpsProviderInfo = {
    id: 'traccar',
    label: 'CONECTADO',
    simulated: false,
    preferredTransport: 'websocket',
  };

  private readonly client: TraccarClient;
  private readonly websocketUrl: string | null;

  /** Cache del enlace dispositivo Traccar <-> vehiculo interno. */
  private linkCache: { links: DeviceVehicleLink[]; expiresAt: number } | null = null;

  constructor() {
    const env = getServerEnv();

    if (!env.TRACCAR_BASE_URL) {
      throw new GpsProviderError(
        'GPS_PROVIDER=traccar requiere TRACCAR_BASE_URL. Revisa .env.local contra .env.example.',
      );
    }

    const authHeader = buildTraccarAuthHeader({
      token: env.TRACCAR_TOKEN,
      username: env.TRACCAR_USERNAME,
      password: env.TRACCAR_PASSWORD,
    });
    if (!authHeader) {
      throw new GpsProviderError(
        'GPS_PROVIDER=traccar requiere TRACCAR_TOKEN, o bien TRACCAR_USERNAME y TRACCAR_PASSWORD.',
      );
    }

    this.client = new TraccarClient({ baseUrl: env.TRACCAR_BASE_URL, authHeader });
    this.websocketUrl = env.TRACCAR_WEBSOCKET_URL ?? null;
  }

  /**
   * Resuelve la correspondencia entre dispositivos de Traccar y vehiculos.
   *
   * Estrategia: enlazar por `GpsDevice.externalId`; si falta, por IMEI
   * (`uniqueId` en Traccar, o el "Device Identifier" de Traccar Client). El
   * operador lo fija asociando un dispositivo desde la ficha del vehiculo
   * ("Conectar GPS"); esa asociacion vive en `dispositivos_gps`.
   */
  private async getLinks(): Promise<DeviceVehicleLink[]> {
    if (this.linkCache && this.linkCache.expiresAt > Date.now()) return this.linkCache.links;

    const devices = await this.client.getDevices();
    const vehicles = await this.getVehicles();

    const byExternalId = new Map(
      vehicles.filter((v) => v.device?.externalId).map((v) => [v.device!.externalId!, v]),
    );
    const byImei = new Map(vehicles.filter((v) => v.device).map((v) => [v.device!.imei, v]));

    const links: DeviceVehicleLink[] = [];

    for (const device of devices) {
      const vehicle = byExternalId.get(String(device.id)) ?? byImei.get(device.uniqueId);
      if (!vehicle?.device) continue;

      links.push({
        traccarDeviceId: device.id,
        imei: device.uniqueId,
        vehicleId: vehicle.id,
        internalDeviceId: vehicle.device.id,
      });
    }

    this.linkCache = { links, expiresAt: Date.now() + 60_000 };
    return links;
  }

  /**
   * La flota es un artefacto propio de la plataforma (`vehicle-store`, sobre
   * Supabase), no del ERP de Fenice: Traccar solo aporta telemetria sobre esos
   * mismos vehiculos.
   */
  async getVehicles(): Promise<Vehicle[]> {
    return listVehicles();
  }

  async getAllCurrentPositions(): Promise<Position[]> {
    const links = await this.getLinks();
    const index = buildDeviceIndex(links);
    const raw = await this.client.getPositions();

    return raw
      .map((position) => {
        const link = index.get(position.deviceId);
        return link ? mapTraccarPosition(position, link) : null;
      })
      .filter((p): p is Position => p !== null);
  }

  async getVehiclePosition(vehicleId: VehicleId): Promise<Position | null> {
    const positions = await this.getAllCurrentPositions();
    return positions.find((p) => p.vehicleId === vehicleId) ?? null;
  }

  async getPositionHistory(query: PositionHistoryQuery): Promise<Position[]> {
    const links = await this.getLinks();
    const link = links.find((l) => l.vehicleId === query.vehicleId);
    if (!link) return [];

    const raw = await this.client.request<TraccarPosition[]>('/positions', {
      deviceId: String(link.traccarDeviceId),
      from: new Date(query.from).toISOString(),
      to: new Date(query.to).toISOString(),
    });

    const mapped = raw
      .map((position) => mapTraccarPosition(position, link))
      .filter((p): p is Position => p !== null);

    return normalizeGpsHistory(mapped, query.limit);
  }

  async getVehicleEvents(query: VehicleEventsQuery): Promise<GpsEvent[]> {
    const links = await this.getLinks();
    const index = buildDeviceIndex(links);

    const params: Record<string, string> = {
      from: new Date(query.from ?? Date.now() - 86_400_000).toISOString(),
      to: new Date(query.to ?? Date.now()).toISOString(),
    };

    if (query.vehicleId) {
      const link = links.find((l) => l.vehicleId === query.vehicleId);
      if (!link) return [];
      params['deviceId'] = String(link.traccarDeviceId);
    }

    const raw = await this.client.request<TraccarEvent[]>('/reports/events', params);

    return raw
      .map((event) => {
        const link = index.get(event.deviceId);
        return link ? mapTraccarEvent(event, link) : null;
      })
      .filter((e): e is GpsEvent => e !== null)
      .slice(0, query.limit ?? 100);
  }

  async getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]> {
    const links = await this.getLinks();
    const index = buildDeviceIndex(links);
    const devices = await this.client.getDevices();
    const now = new Date();

    return devices
      .map((device) => {
        const link = index.get(device.id);
        if (!link) return null;
        if (vehicleId && link.vehicleId !== vehicleId) return null;
        return mapTraccarDeviceStatus(device, link, now);
      })
      .filter((s): s is DeviceStatus => s !== null);
  }

  /**
   * Construye la URL del socket autenticada por token. Devuelve `null` cuando
   * no hay forma segura de autenticar, lo que fuerza el modo polling.
   */
  private buildSocketUrl(): string | null {
    if (!this.websocketUrl) return null;

    const token = getServerEnv().TRACCAR_TOKEN;
    if (!token) return null;

    try {
      const url = new URL(this.websocketUrl);
      url.searchParams.set('token', token);
      return url.toString();
    } catch {
      return null;
    }
  }

  /**
   * Suscripcion en vivo por WebSocket con degradacion automatica a polling.
   *
   * Traccar publica `/api/socket`, que emite `{positions, devices, events}`.
   * Si el socket no esta configurado o falla, se consulta por intervalo sin
   * que el consumidor note la diferencia.
   */
  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    let closed = false;
    let socket: WebSocket | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = (): void => {
      if (closed || pollTimer) return;
      handlers.onTransportChange?.('polling');

      const poll = async (): Promise<void> => {
        try {
          handlers.onPositions(await this.getAllCurrentPositions());
        } catch (error) {
          handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      };

      void poll();
      pollTimer = setInterval(() => void poll(), getServerEnv().GPS_REFRESH_INTERVAL_MS);
    };

    // El WebSocket estandar no admite cabeceras. Traccar acepta el token JWT
    // por query string en `/api/socket`, que es la via soportada para
    // autenticar el socket sin cookie de sesion. Sin token, se usa polling.
    const socketUrl = this.buildSocketUrl();

    if (!socketUrl) {
      startPolling();
    } else {
      try {
        socket = new WebSocket(socketUrl);

        socket.addEventListener('open', () => handlers.onTransportChange?.('websocket'));

        socket.addEventListener('message', (event: MessageEvent) => {
          void (async () => {
            try {
              const payload = JSON.parse(String(event.data)) as { positions?: TraccarPosition[] };
              if (!payload.positions?.length) return;

              const links = await this.getLinks();
              const index = buildDeviceIndex(links);
              const positions = payload.positions
                .map((p) => {
                  const link = index.get(p.deviceId);
                  return link ? mapTraccarPosition(p, link) : null;
                })
                .filter((p): p is Position => p !== null);

              if (positions.length > 0) handlers.onPositions(positions);
            } catch (error) {
              handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
            }
          })();
        });

        socket.addEventListener('error', () => startPolling());
        socket.addEventListener('close', () => {
          if (!closed) startPolling();
        });
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        startPolling();
      }
    }

    return () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      socket?.close();
      handlers.onTransportChange?.('disconnected');
    };
  }

  /** Diagnostico rapido: usado por `/api/system/gps` y por la pantalla de configuracion de GPS. */
  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    const start = Date.now();
    try {
      const devices = await this.client.getDevices();
      return {
        ok: true,
        message: `Conectado. ${devices.length} dispositivo(s) visibles en el servidor.`,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: null,
      };
    }
  }
}
