import 'server-only';

import { getServerEnv } from '@/config/env';
import { getOperationalSettings } from '@/services/settings/settings-store';
import type {
  DeviceStatus,
  GpsEvent,
  Position,
  Vehicle,
  VehicleId,
} from '@/types/core';
import {
  GpsProviderError,
  type GpsProvider,
  type GpsProviderInfo,
  type PositionHistoryQuery,
  type PositionSubscriptionHandlers,
  type Unsubscribe,
  type VehicleEventsQuery,
} from '@/services/gps/gps-provider';
import { TridTrackingClient } from './tridtracking-client';
import {
  mapUnitToDeviceStatus,
  mapUnitToPosition,
  mapUnitToVehicle,
  toIsoUtc,
} from './tridtracking-mapper';
import type { TridAlert, TridUnit } from './tridtracking-types';

/**
 * Telemetria real desde 3DTracking (Client WebApi v1.0).
 *
 * La API no ofrece websocket ni streaming, asi que la suscripcion en vivo se
 * resuelve por sondeo. Se aprovecha `LastDateReceivedUtc` de
 * `latestpositionslist`, que devuelve SOLO lo reportado despues de esa marca:
 * el trafico se mantiene proporcional a lo que de verdad cambia, en vez de
 * traer la flota entera cada pocos segundos.
 *
 * Documentacion: https://apiv2.3dtracking.net/docs/v1/
 */

const ENDPOINTS = {
  units: '/api/v1.0/units/unit/list',
  latest: '/api/v1.0/units/latestpositionslist',
  history: '/api/v1.0/data/positionslist',
  alerts: '/api/v1.0/alerts/alerts/list',
} as const;

/** Vida de la cache de unidades: el parque cambia de tanto en tanto. */
const UNITS_TTL_MS = 5 * 60_000;

/**
 * Clasifica la alerta del proveedor en el vocabulario interno.
 *
 * `GpsEventType` es una lista cerrada a proposito. Lo que no encaja se
 * traduce al evento mas cercano y conserva su texto original en `detail`,
 * en lugar de inventar una categoria nueva que ningun motor sabria tratar.
 */
function classifyAlert(nombre: string | null | undefined): GpsEvent['type'] {
  const t = (nombre ?? '').toLowerCase();

  if (t.includes('geofence') || t.includes('zone') || t.includes('location')) {
    return t.includes('exit') || t.includes('salida') ? 'geofence_exit' : 'geofence_enter';
  }
  if (t.includes('ignition') || t.includes('encendido')) {
    return t.includes('off') || t.includes('apagado') ? 'ignition_off' : 'ignition_on';
  }
  if (t.includes('speed') || t.includes('velocidad')) return 'overspeed';
  if (t.includes('brak') || t.includes('frenad')) return 'harsh_braking';
  if (t.includes('accel') || t.includes('acelerac')) return 'harsh_acceleration';
  if (t.includes('idle') || t.includes('ralenti')) return t.includes('end') ? 'idle_end' : 'idle_start';
  if (t.includes('power') || t.includes('corte')) return 'power_cut';
  if (t.includes('sos') || t.includes('panic')) return 'sos';
  if (t.includes('offline') || t.includes('disconnect')) return 'device_offline';
  return 'device_online';
}

export class TridTrackingGpsProvider implements GpsProvider {
  readonly info: GpsProviderInfo = {
    id: '3dtracking',
    label: 'CONECTADO',
    simulated: false,
    // La API es de consulta: no hay canal de servidor a cliente.
    preferredTransport: 'polling',
  };

  private readonly client: TridTrackingClient;
  private units: { data: TridUnit[]; expiresAt: number } | null = null;

  constructor() {
    const env = getServerEnv();

    // Se valida al construir, no al importar: en modo demostracion esta clase
    // nunca se instancia y no debe exigir credenciales.
    if (!env.TRIDTRACKING_USERNAME || !env.TRIDTRACKING_PASSWORD) {
      throw new GpsProviderError(
        'GPS_PROVIDER=3dtracking requiere TRIDTRACKING_USERNAME y TRIDTRACKING_PASSWORD. ' +
          'Revisa .env.local contra .env.example.',
      );
    }

    this.client = new TridTrackingClient({
      baseUrl: env.TRIDTRACKING_BASE_URL ?? 'https://apiv2.3dtracking.net',
      username: env.TRIDTRACKING_USERNAME,
      password: env.TRIDTRACKING_PASSWORD,
      timeoutMs: env.TRIDTRACKING_TIMEOUT_MS,
    });
  }

  /**
   * Unidades con su ultima posicion.
   *
   * Es la respuesta que alimenta casi todo: vehiculos, posiciones y estado de
   * los equipos salen de la misma llamada, de modo que una pantalla completa
   * no dispara tres peticiones al proveedor.
   */
  private async fetchLatest(unitUid?: string): Promise<TridUnit[]> {
    const data = await this.client.call<TridUnit[] | null>(ENDPOINTS.latest, {
      ...(unitUid ? { UnitUid: unitUid } : {}),
    });
    return Array.isArray(data) ? data : [];
  }

  private async getUnits(): Promise<TridUnit[]> {
    if (this.units && Date.now() < this.units.expiresAt) return this.units.data;

    const data = await this.client.call<TridUnit[] | null>(ENDPOINTS.units);
    const lista = Array.isArray(data) ? data : [];
    this.units = { data: lista, expiresAt: Date.now() + UNITS_TTL_MS };
    return lista;
  }

  async getVehicles(): Promise<Vehicle[]> {
    const unidades = await this.getUnits();
    return unidades
      .map(mapUnitToVehicle)
      .filter((v): v is Vehicle => v !== null)
      .sort((a, b) => a.plate.localeCompare(b.plate, 'es'));
  }

  async getAllCurrentPositions(): Promise<Position[]> {
    const unidades = await this.fetchLatest();
    return unidades.map(mapUnitToPosition).filter((p): p is Position => p !== null);
  }

  async getVehiclePosition(vehicleId: VehicleId): Promise<Position | null> {
    const unidades = await this.fetchLatest(String(vehicleId));
    const posiciones = unidades
      .map(mapUnitToPosition)
      .filter((p): p is Position => p !== null && p.vehicleId === vehicleId);
    return posiciones[0] ?? null;
  }

  /**
   * Historial de posiciones.
   *
   * `positionslist` no acepta un rango de fechas: avanza por `StartId`, un
   * cursor incremental. Se pagina hacia adelante y se recorta por fecha aqui,
   * con un tope de paginas para que una ventana amplia no acabe descargando
   * meses de historia y agotando el tiempo de la peticion.
   */
  async getPositionHistory(query: PositionHistoryQuery): Promise<Position[]> {
    const desde = Date.parse(query.from);
    const hasta = Date.parse(query.to);
    const limite = query.limit ?? 1000;

    const acumuladas: Position[] = [];
    let startId = 0;
    const MAX_PAGINAS = 20;

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const lote = await this.client.call<TridUnit[] | null>(ENDPOINTS.history, {
        Uid: String(query.vehicleId),
        StartId: String(startId),
      });
      const unidades = Array.isArray(lote) ? lote : [];
      if (unidades.length === 0) break;

      for (const unidad of unidades) {
        const posicion = mapUnitToPosition(unidad);
        if (posicion === null) continue;
        const t = Date.parse(posicion.timestamp);
        if (t >= desde && t <= hasta) acumuladas.push(posicion);
      }

      if (acumuladas.length >= limite) break;
      startId += unidades.length;
    }

    return acumuladas
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
      .slice(-limite);
  }

  async getVehicleEvents(query: VehicleEventsQuery): Promise<GpsEvent[]> {
    const data = await this.client.call<TridAlert[] | null>(ENDPOINTS.alerts, {});
    const alertas = Array.isArray(data) ? data : [];

    const eventos: GpsEvent[] = [];
    for (const alerta of alertas) {
      const vehicleId = (alerta.UnitUid ?? '').trim();
      const timestamp = toIsoUtc(alerta.DateTimeUtc);
      if (vehicleId === '' || timestamp === null) continue;
      if (query.vehicleId && vehicleId !== String(query.vehicleId)) continue;
      if (query.from && Date.parse(timestamp) < Date.parse(query.from)) continue;
      if (query.to && Date.parse(timestamp) > Date.parse(query.to)) continue;

      eventos.push({
        id: (alerta.Uid ?? `${vehicleId}-${timestamp}`).trim(),
        vehicleId: vehicleId as VehicleId,
        deviceId: vehicleId as GpsEvent['deviceId'],
        type: classifyAlert(alerta.AlertTypeName ?? alerta.AlertType),
        timestamp,
        ...(typeof alerta.Latitude === 'number' && typeof alerta.Longitude === 'number'
          ? { position: { lat: alerta.Latitude, lng: alerta.Longitude } }
          : {}),
        ...(alerta.Description ? { detail: alerta.Description } : {}),
      });
    }

    return eventos
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, query.limit ?? 200);
  }

  async getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]> {
    const settings = getOperationalSettings();
    const unidades = await this.fetchLatest(vehicleId ? String(vehicleId) : undefined);
    const now = new Date();

    return unidades
      .map((unidad) =>
        mapUnitToDeviceStatus(unidad, now, {
          staleSeconds: settings.gps.staleSeconds,
          lostSeconds: settings.gps.signalLostSeconds,
          offlineSeconds: settings.gps.offlineSeconds,
        }),
      )
      .filter((d): d is DeviceStatus => d !== null)
      .filter((d) => !vehicleId || d.vehicleId === vehicleId);
  }

  /**
   * Sondeo en vivo.
   *
   * `LastDateReceivedUtc` hace que cada consulta devuelva solo lo reportado
   * desde la anterior. La marca se avanza con la posicion mas reciente
   * RECIBIDA, no con el reloj local: si el servidor va desfasado respecto a
   * nosotros, usar la hora local dejaria fuera posiciones legitimas.
   */
  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    const env = getServerEnv();
    let cancelado = false;
    let ultimaMarca: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    handlers.onTransportChange?.('polling');

    const sondear = async (): Promise<void> => {
      if (cancelado) return;

      try {
        const unidades = await this.client.call<TridUnit[] | null>(ENDPOINTS.latest, {
          ...(ultimaMarca ? { LastDateReceivedUtc: ultimaMarca } : {}),
        });
        const lista = Array.isArray(unidades) ? unidades : [];
        const posiciones = lista.map(mapUnitToPosition).filter((p): p is Position => p !== null);

        if (posiciones.length > 0) {
          const masReciente = posiciones.reduce((max, p) =>
            Date.parse(p.timestamp) > Date.parse(max.timestamp) ? p : max,
          );
          ultimaMarca = masReciente.timestamp;
          handlers.onPositions(posiciones);
        }
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      } finally {
        if (!cancelado) timer = setTimeout(() => void sondear(), env.GPS_REFRESH_INTERVAL_MS);
      }
    };

    void sondear();

    return () => {
      cancelado = true;
      if (timer) clearTimeout(timer);
      handlers.onTransportChange?.('disconnected');
    };
  }

  /** Diagnostico de conectividad para la pantalla de configuracion. */
  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    return this.client.healthCheck();
  }
}
