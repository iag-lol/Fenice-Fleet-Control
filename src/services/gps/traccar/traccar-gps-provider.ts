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
    preferredTransport: 'polling',
  };

  private readonly client: TraccarClient;

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

    const links: DeviceVehicleLink[] = [];
    for (const device of devices) {
      if (device.disabled) continue;
      // El IMEI es la identidad del equipo. Un id numerico guardado puede
      // cambiar si se recrea el dispositivo o se migra el servidor.
      const vehicle = vehicles.find((v) => v.device?.imei === device.uniqueId &&
        (!v.device.provider || v.device.provider === 'traccar') &&
        (!v.device.serverUrl || v.device.serverUrl.replace(/\/+$/, '') ===
          getServerEnv().TRACCAR_BASE_URL?.replace(/\/+$/, '')));
      if (!vehicle?.device) continue;
      links.push({ traccarDeviceId: device.id, imei: device.uniqueId,
        vehicleId: vehicle.id, internalDeviceId: vehicle.device.id });
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
    const selected = query.vehicleId ? links.filter((l) => l.vehicleId === query.vehicleId) : links;
    const events = await Promise.all(selected.map(async (link) => {
      const raw = await this.client.request<TraccarEvent[]>('/reports/events', {
        deviceId: String(link.traccarDeviceId),
        from: new Date(query.from ?? Date.now() - 86_400_000).toISOString(),
        to: new Date(query.to ?? Date.now()).toISOString(),
      });
      return raw.filter((event) => event.deviceId === link.traccarDeviceId)
        .map((event) => mapTraccarEvent(event, link)).filter((e): e is GpsEvent => e !== null);
    }));
    return events.flat().sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, query.limit ?? 100);
  }

  async getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]> {
    const links = await this.getLinks();
    const index = buildDeviceIndex(links);
    const [devices, positions] = await Promise.all([this.client.getDevices(), this.getAllCurrentPositions()]);
    const now = new Date();

    return devices
      .map((device) => {
        const link = index.get(device.id);
        if (!link) return null;
        if (vehicleId && link.vehicleId !== vehicleId) return null;
        return mapTraccarDeviceStatus(device, link, now, positions.find((p) => p.vehicleId === link.vehicleId) ?? null);
      })
      .filter((s): s is DeviceStatus => s !== null);
  }

  /**
   * Sondeo autenticado. Traccar exige cookie de sesion para /api/socket;
   * agregar un token a esa URL no autentica el WebSocket estandar de Node.
   */
  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    let closed = false;
    let pending = false;
    handlers.onTransportChange?.('polling');
    const poll = async (): Promise<void> => {
      if (closed || pending) return;
      pending = true;
      try {
        const positions = await this.getAllCurrentPositions();
        if (!closed) handlers.onPositions(positions);
      } catch (error) {
        if (!closed) handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally { pending = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), getServerEnv().GPS_REFRESH_INTERVAL_MS);
    return () => { closed = true; clearInterval(timer); handlers.onTransportChange?.('disconnected'); };
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
