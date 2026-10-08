import 'server-only';

import { normalizeGpsHistory } from '@/lib/gps-history';
import { getServerEnv } from '@/config/env';
import { listVehicles } from '@/services/fleet/vehicle-store';
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
import type {
  TridAlertList,
  TridPositionList,
  TridUnit,
} from './tridtracking-types';

/**
 * Telemetria real desde 3DTracking (Client WebApi v1.0).
 *
 * La suscripcion usa instantaneas por sondeo. Las lecturas concurrentes
 * comparten cache y no dependen de un cursor calculado desde el reloj GPS.
 *
 * Documentacion: https://apiv2.3dtracking.net/docs/v1/
 */

const CLIENT_ENDPOINTS = {
  units: '/api/v1.0/units/unit/list',
  latest: '/api/v1.0/units/latestpositionslist',
  history: '/api/v1.0/data/positionslist',
  alerts: '/api/v1.0/alerts/alerts/list',
} as const;

const PARTNER_ENDPOINTS = {
  units: '/api/v1.0/Units/List',
  latest: '/api/v1.0/Units/LatestPositionsList',
  history: '/api/v1.0/Data/PositionsList',
  alerts: null,
} as const;

/** Vida de la cache de unidades: el parque cambia de tanto en tanto. */
const UNITS_TTL_MS = 60_000;

/**
 * Clasifica la alerta del proveedor en el vocabulario interno.
 *
 * `GpsEventType` es una lista cerrada a proposito. Lo que no encaja se
 * descarta: una alerta desconocida no demuestra una recuperacion de señal.
 */
function classifyAlert(
  nombre: string | null | undefined,
): GpsEvent['type'] | null {
  const t = (nombre ?? '').toLowerCase();

  if (t.includes('geofence') || t.includes('zone') || t.includes('location')) {
    return t.includes('exit') || t.includes('salida')
      ? 'geofence_exit'
      : 'geofence_enter';
  }
  if (t.includes('ignition') || t.includes('encendido')) {
    return t.includes('off') || t.includes('apagado')
      ? 'ignition_off'
      : 'ignition_on';
  }
  if (t.includes('speed') || t.includes('velocidad')) return 'overspeed';
  if (t.includes('brak') || t.includes('frenad')) return 'harsh_braking';
  if (t.includes('accel') || t.includes('acelerac'))
    return 'harsh_acceleration';
  if (t.includes('idle') || t.includes('ralenti'))
    return t.includes('end') ? 'idle_end' : 'idle_start';
  if (t.includes('power') || t.includes('corte')) return 'power_cut';
  if (t.includes('sos') || t.includes('panic')) return 'sos';
  if (t.includes('offline') || t.includes('disconnect'))
    return 'device_offline';
  if (t.includes('online') || t.includes('connect')) return 'device_online';
  return null;
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
  private readonly apiMode: 'client' | 'partner';
  private readonly companyUid: string | undefined;
  private readonly endpoints: Record<
    keyof typeof CLIENT_ENDPOINTS,
    string | null
  >;
  private units: { data: TridUnit[]; expiresAt: number } | null = null;
  private unitsPending: Promise<TridUnit[]> | null = null;
  private latest: { data: TridUnit[]; expiresAt: number } | null = null;
  private latestPending: Promise<TridUnit[]> | null = null;

  constructor() {
    const env = getServerEnv();
    this.apiMode = env.TRIDTRACKING_API_MODE ?? 'client';
    this.companyUid = env.TRIDTRACKING_COMPANY_UID;
    this.endpoints =
      this.apiMode === 'partner' ? PARTNER_ENDPOINTS : CLIENT_ENDPOINTS;

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
      apiMode: this.apiMode,
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
    // Posiciones y salud de equipo comparten la misma instantanea. Las
    // consultas concurrentes del mapa no abren lecturas duplicadas.
    if (!this.latest || Date.now() >= this.latest.expiresAt) {
      if (!this.latestPending)
        this.latestPending = (async () => {
          const data = await this.client.call<TridUnit[] | null>(
            this.endpoints.latest!,
            this.apiMode === 'partner' && this.companyUid
              ? { CompanyUids: this.companyUid }
              : {},
          );
          if (data !== null && !Array.isArray(data))
            throw new GpsProviderError(
              'Formato de posiciones incompatible en 3DTracking.',
            );
          const units = data ?? [];
          this.latest = {
            data: units,
            expiresAt: Date.now() + Math.max(15_000, getOperationalSettings().gps.refreshIntervalMs),
          };
          return units;
        })();
      try {
        await this.latestPending;
      } finally {
        this.latestPending = null;
      }
    }
    const data = this.latest!.data;
    return unitUid ? data.filter((unit) => unit.Uid === unitUid) : data;
  }

  private async getUnits(): Promise<TridUnit[]> {
    if (this.units && Date.now() < this.units.expiresAt) return this.units.data;
    if (!this.unitsPending)
      this.unitsPending = (async () => {
        const data = await this.client.call<TridUnit[] | null>(
          this.endpoints.units!,
          this.apiMode === 'partner' && this.companyUid
            ? { CompanyUid: this.companyUid }
            : {},
        );
        if (data !== null && !Array.isArray(data))
          throw new GpsProviderError(
            'Formato de flota incompatible en 3DTracking.',
          );
        const lista = data ?? [];
        this.units = { data: lista, expiresAt: Date.now() + UNITS_TTL_MS };
        return lista;
      })();
    try {
      return await this.unitsPending;
    } finally {
      this.unitsPending = null;
    }
  }

  /** El IMEI une el UID del proveedor con el id de la flota propia. */
  private async identities(): Promise<Map<string, Vehicle>> {
    const [units, local] = await Promise.all([this.getUnits(), listVehicles()]);
    const identities = new Map<string, Vehicle>();
    for (const unit of units) {
      const mapped = mapUnitToVehicle(unit);
      if (!mapped) continue;
      const matches = local.filter(
        (vehicle) =>
          mapped.device?.imei && vehicle.device?.imei === mapped.device.imei,
      );
      if (matches.length > 1)
        throw new GpsProviderError(
          'Un IMEI de 3DTracking esta asociado a varios vehiculos.',
        );
      const known = matches[0];
      identities.set(
        String(mapped.id),
        known ? { ...known, device: mapped.device } : mapped,
      );
    }
    return identities;
  }

  private async unitUid(vehicleId: VehicleId): Promise<string> {
    const identities = await this.identities();
    return (
      [...identities].find(([, vehicle]) => vehicle.id === vehicleId)?.[0] ??
      String(vehicleId)
    );
  }

  async getVehicles(): Promise<Vehicle[]> {
    return [...(await this.identities()).values()].sort((a, b) =>
      a.plate.localeCompare(b.plate, 'es'),
    );
  }

  async getAllCurrentPositions(): Promise<Position[]> {
    const [units, identities] = await Promise.all([
      this.fetchLatest(),
      this.identities(),
    ]);
    return units
      .map(mapUnitToPosition)
      .filter((p): p is Position => p !== null)
      .map((p) => ({
        ...p,
        vehicleId: identities.get(String(p.vehicleId))?.id ?? p.vehicleId,
        simulated: false,
      }));
  }

  async getVehiclePosition(vehicleId: VehicleId): Promise<Position | null> {
    return (
      (await this.getAllCurrentPositions()).find(
        (p) => p.vehicleId === vehicleId,
      ) ?? null
    );
  }

  /** Historial por hora UTC inicial y cursor StartId devuelto por la API. */
  async getPositionHistory(query: PositionHistoryQuery): Promise<Position[]> {
    const from = Date.parse(query.from);
    const to = Date.parse(query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
      throw new GpsProviderError('Rango de historial GPS invalido.');
    }
    if (this.apiMode === 'partner' && from < Date.now() - 7 * 86400000) {
      throw new GpsProviderError(
        'Partner API ofrece los últimos 7 días. Consulta el archivo GPS para fechas anteriores.',
      );
    }
    const uid = await this.unitUid(query.vehicleId);
    const positions: Position[] = [];
    let cursor: number | null = null;
    for (let page = 0; page < 20; page += 1) {
      const data: TridPositionList | null =
        await this.client.call<TridPositionList | null>(
          this.endpoints.history!,
          {
            Uid: uid,
            ...(cursor === null
              ? this.apiMode === 'partner'
                ? from < Date.now() - 86400000
                  ? { StartId: '0' }
                  : {}
                : {
                    StartHourUtc: new Date(
                      Math.floor(from / 3_600_000) * 3_600_000,
                    ).toISOString(),
                  }
              : { StartId: String(cursor) }),
          },
        );
      if (
        !data ||
        (data.Position !== null && !Array.isArray(data.Position)) ||
        (this.apiMode === 'client' && typeof data.IsCurrent !== 'boolean')
      ) {
        throw new GpsProviderError(
          'Formato de historial incompatible en 3DTracking.',
        );
      }
      for (const raw of data.Position ?? []) {
        // El historial devuelve Position con Unit, no unidades con Position.
        if (raw.Unit?.Uid !== uid) continue;
        const position = mapUnitToPosition({ ...raw.Unit, Position: raw });
        if (
          position &&
          Date.parse(position.timestamp) >= from &&
          Date.parse(position.timestamp) <= to
        )
          positions.push({
            ...position,
            vehicleId: query.vehicleId,
            simulated: false,
          });
      }
      if (
        data.IsCurrent ||
        (this.apiMode === 'partner' && (data.Position ?? []).length === 0)
      )
        return normalizeGpsHistory(positions, query.limit);
      if (
        !Number.isSafeInteger(data.StartId) ||
        data.StartId! < 0 ||
        data.StartId === cursor
      ) {
        throw new GpsProviderError(
          '3DTracking no avanzo el cursor del historial.',
        );
      }
      cursor = data.StartId!;
    }
    throw new GpsProviderError(
      'El historial de 3DTracking supera 20 paginas. Acota el rango o usa el archivo local.',
    );
  }

  async getVehicleEvents(query: VehicleEventsQuery): Promise<GpsEvent[]> {
    // Partner API no publica un endpoint de alertas; los eventos observados
    // de ignición y detención se analizan a partir del historial disponible.
    if (!this.endpoints.alerts) return [];
    const [data, units, identities] = await Promise.all([
      this.client.call<TridAlertList | null>(this.endpoints.alerts),
      this.getUnits(),
      this.identities(),
    ]);
    if (data !== null && !Array.isArray(data.AlertList))
      throw new GpsProviderError(
        'Formato de alertas incompatible en 3DTracking.',
      );
    const events: GpsEvent[] = [];
    for (const alert of data?.AlertList ?? []) {
      // Vehicle es el nombre de la unidad; solo resolverlo si es univoco.
      const matches = units.filter(
        (unit) =>
          unit.Name?.trim() === alert.Vehicle?.trim() ||
          unit.Uid === alert.Vehicle,
      );
      if (matches.length !== 1) continue;
      const unitId = matches[0]!.Uid?.trim();
      const vehicleId = unitId ? (identities.get(unitId)?.id ?? unitId) : null;
      const timestamp = toIsoUtc(alert.CreatedDate);
      const type = classifyAlert(
        `${alert.AlertType ?? ''} ${alert.AlertName ?? ''}`,
      );
      if (!vehicleId || !timestamp || !type) continue;
      if (query.vehicleId && vehicleId !== String(query.vehicleId)) continue;
      if (query.from && Date.parse(timestamp) < Date.parse(query.from))
        continue;
      if (query.to && Date.parse(timestamp) > Date.parse(query.to)) continue;
      events.push({
        id: alert.AlertUID ?? `${vehicleId}-${timestamp}-${type}`,
        vehicleId: vehicleId as VehicleId,
        deviceId: (matches[0]!.Imei || vehicleId) as GpsEvent['deviceId'],
        type,
        timestamp,
        ...(alert.AlertMessage ? { detail: alert.AlertMessage } : {}),
      });
    }
    return events
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
      .slice(0, query.limit ?? 200);
  }

  async getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]> {
    const settings = getOperationalSettings();
    const [unidades, identities] = await Promise.all([
      this.fetchLatest(),
      this.identities(),
    ]);
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
      .map((d) => ({
        ...d,
        vehicleId: identities.get(String(d.vehicleId))?.id ?? d.vehicleId,
      }))
      .filter((d) => !vehicleId || d.vehicleId === vehicleId);
  }

  /**
   * Instantaneas completas por sondeo: incluye registros reenviados despues
   * de un corte y evita depender de un cursor con reloj de fix antiguo.
   */
  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    handlers.onTransportChange?.('polling');
    const poll = async (): Promise<void> => {
      if (closed) return;
      try {
        const positions = await this.getAllCurrentPositions();
        if (!closed) handlers.onPositions(positions);
      } catch (error) {
        if (!closed)
          handlers.onError?.(
            error instanceof Error ? error : new Error(String(error)),
          );
      } finally {
        if (!closed)
          timer = setTimeout(
            () => void poll(),
            getServerEnv().GPS_REFRESH_INTERVAL_MS,
          );
      }
    };
    void poll();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      handlers.onTransportChange?.('disconnected');
    };
  }

  /** Diagnostico de conectividad para la pantalla de configuracion. */
  async healthCheck(): Promise<{
    ok: boolean;
    message: string;
    latencyMs: number | null;
  }> {
    return this.client.healthCheck();
  }
}
