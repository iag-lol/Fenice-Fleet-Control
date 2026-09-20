import type {
  GpsProvider,
  GpsProviderInfo,
  GpsTransport,
  PositionHistoryQuery,
  PositionSubscriptionHandlers,
  Unsubscribe,
  VehicleEventsQuery,
} from '@/services/gps/gps-provider';
import { GpsProviderError } from '@/services/gps/gps-provider';
import type { DeviceStatus, GpsEvent, Position, Vehicle, VehicleId } from '@/types/core';
import type { LivePositionsPayload } from '@/types/views';

/**
 * Proveedor GPS del navegador.
 *
 * Implementa EXACTAMENTE el mismo contrato `GpsProvider` que las
 * implementaciones de servidor, pero sobre HTTP. Por eso los componentes
 * consumen siempre la interfaz y jamas saben si detras hay un simulador, un
 * Traccar real o un proxy: cambiar la fuente no toca la UI.
 *
 * Ademas cumple una funcion de seguridad: las credenciales de Traccar nunca
 * salen del servidor, el navegador solo habla con /api/gps/*.
 */
export class HttpGpsProvider implements GpsProvider {
  info: GpsProviderInfo;

  private pollingIntervalMs = 15_000;

  constructor(info?: Partial<GpsProviderInfo>) {
    this.info = {
      id: info?.id ?? 'mock',
      label: info?.label ?? 'DEMO',
      simulated: info?.simulated ?? true,
      preferredTransport: info?.preferredTransport ?? 'sse',
    };
  }

  private async fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await fetch(path, { cache: 'no-store', signal });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new GpsProviderError(body?.error ?? `La solicitud a ${path} fallo (${response.status}).`);
    }

    return (await response.json()) as T;
  }

  async getVehicles(): Promise<Vehicle[]> {
    const snapshots = await this.fetchJson<{ vehicle: Vehicle }[]>('/api/fleet');
    return snapshots.map((s) => s.vehicle);
  }

  async getAllCurrentPositions(): Promise<Position[]> {
    const payload = await this.fetchJson<LivePositionsPayload>('/api/gps/positions');
    return payload.positions;
  }

  async getVehiclePosition(vehicleId: VehicleId): Promise<Position | null> {
    const positions = await this.getAllCurrentPositions();
    return positions.find((p) => p.vehicleId === vehicleId) ?? null;
  }

  async getPositionHistory(query: PositionHistoryQuery): Promise<Position[]> {
    const params = new URLSearchParams({ desde: query.from, hasta: query.to });
    if (query.limit) params.set('limite', String(query.limit));
    return this.fetchJson<Position[]>(`/api/gps/history/${query.vehicleId}?${params.toString()}`);
  }

  async getVehicleEvents(_query: VehicleEventsQuery): Promise<GpsEvent[]> {
    // Los eventos llegan ya interpretados dentro del detalle del vehiculo
    // (`/api/fleet/[id]`), como linea de tiempo. No se expone un endpoint
    // crudo al navegador porque ningun consumidor de UI lo necesita.
    return [];
  }

  async getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]> {
    const payload = await this.fetchJson<LivePositionsPayload>('/api/gps/positions');
    return payload.vehicles
      .map((v) => v.device)
      .filter((d): d is DeviceStatus => d !== null)
      .filter((d) => !vehicleId || d.vehicleId === vehicleId);
  }

  /**
   * Suscripcion en vivo: SSE como transporte preferido, polling como respaldo.
   *
   * La degradacion es automatica y silenciosa para el consumidor; solo se
   * informa por `onTransportChange` para que el indicador del header muestre
   * el transporte real en uso.
   */
  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    let closed = false;
    let suspended = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let watchdog: ReturnType<typeof setInterval> | null = null;
    let pending: AbortController | null = null;
    let lastStreamAt = Date.now();
    const canStream = typeof EventSource !== 'undefined' && this.info.preferredTransport !== 'polling';

    const poll = async (): Promise<void> => {
      if (closed || suspended || pending) return;
      const controller = new AbortController();
      pending = controller;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
        const payload = await this.fetchJson<LivePositionsPayload>('/api/gps/positions', signal);
        if (!closed && !suspended && !controller.signal.aborted) {
          handlers.onSnapshot?.(payload);
          handlers.onPositions(payload.positions);
        }
      } catch (error) {
        if (!closed && !suspended && !controller.signal.aborted) {
          handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (pending === controller) pending = null;
      }
    };
    const stopPolling = (): void => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = (): void => {
      if (closed || suspended || pollTimer) return;
      handlers.onTransportChange?.('polling');
      void poll();
      pollTimer = setInterval(() => void poll(), this.pollingIntervalMs);
    };
    const openStream = (): void => {
      if (!canStream || closed || suspended || source) return;
      try {
        const current = new EventSource('/api/gps/stream');
        source = current;
        current.addEventListener('positions', (event) => {
          if (closed || suspended || source !== current) return;
          try {
            const payload = JSON.parse((event as MessageEvent).data) as LivePositionsPayload;
            if (!Array.isArray(payload.positions)) throw new Error('Reporte GPS invalido.');
            lastStreamAt = Date.now();
            stopPolling();
            // Una respuesta de respaldo pendiente no puede pisar el stream recuperado.
            pending?.abort();
            handlers.onTransportChange?.('sse');
            handlers.onSnapshot?.(payload);
            handlers.onPositions(payload.positions);
          } catch (error) {
            handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
            startPolling();
          }
        });
        current.addEventListener('gps-error', (event) => {
          if (closed || suspended) return;
          let message = 'Conexion GPS temporalmente no disponible.';
          try { message = JSON.parse((event as MessageEvent).data).message ?? message; } catch { /* respuesta incompleta */ }
          handlers.onError?.(new GpsProviderError(message));
          startPolling();
        });
        current.addEventListener('error', () => {
          if (closed || suspended) return;
          // CONNECTING tambien necesita respaldo: EventSource puede reintentar indefinidamente.
          startPolling();
          if (current.readyState === EventSource.CLOSED) {
            current.close();
            if (source === current) source = null;
          }
        });
      } catch { startPolling(); }
    };
    const resume = (): void => {
      if (closed) return;
      suspended = false;
      lastStreamAt = Date.now();
      openStream();
      // Recupera el ultimo dato al volver de offline o de la cache de navegacion.
      startPolling();
    };
    const pause = (): void => {
      suspended = true;
      source?.close();
      source = null;
      stopPolling();
      pending?.abort();
      pending = null;
      handlers.onTransportChange?.('disconnected');
    };
    const onVisible = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') resume();
    };

    window.addEventListener?.('online', resume);
    window.addEventListener?.('offline', pause);
    window.addEventListener?.('pagehide', pause);
    window.addEventListener?.('pageshow', resume);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (canStream) {
      openStream();
      watchdog = setInterval(() => {
        if (closed || suspended) return;
        if (Date.now() - lastStreamAt > Math.max(30_000, this.pollingIntervalMs * 2)) startPolling();
        if (!source) openStream();
      }, 5_000);
    } else startPolling();

    return () => {
      closed = true;
      pause();
      if (watchdog) clearInterval(watchdog);
      window.removeEventListener('online', resume);
      window.removeEventListener('offline', pause);
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }

  /**
   * Fija el transporte que el servidor declara viable.
   *
   * No lo decide el navegador: en un despliegue sin servidor el stream se
   * corta cada pocos segundos, y solo el servidor sabe donde esta corriendo.
   */
  setPreferredTransport(transport: GpsTransport): void {
    this.info = { ...this.info, preferredTransport: transport };
  }

  /** Alinea la cadencia del respaldo con la configurada en el servidor. */
  setPollingInterval(ms: number): void {
    // Se aplica a la proxima suscripcion.
    if (Number.isFinite(ms) && ms >= 3000) this.pollingIntervalMs = ms;
  }

  get pollingInterval(): number {
    return this.pollingIntervalMs;
  }
}

export const GPS_TRANSPORT_LABEL: Record<GpsTransport, string> = {
  websocket: 'WebSocket',
  sse: 'Streaming',
  polling: 'Consulta periodica',
  disconnected: 'Desconectado',
};
