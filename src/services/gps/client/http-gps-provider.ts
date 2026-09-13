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
    let polling = false;
    const abort = new AbortController();
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = (): void => {
      if (closed || pollTimer) return;
      handlers.onTransportChange?.('polling');

      const poll = async (): Promise<void> => {
        if (closed || polling) return;
        polling = true;
        try {
          const payload = await this.fetchJson<LivePositionsPayload>('/api/gps/positions', abort.signal);
          if (!closed) handlers.onPositions(payload.positions);
        } catch (error) {
          if (!closed) handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
        } finally {
          polling = false;
        }
      };

      void poll();
      pollTimer = setInterval(() => void poll(), this.pollingIntervalMs);
    };

    /**
     * Cierre explicito antes de que la pagina se descargue.
     *
     * Al navegar, el contexto de JavaScript se destruye sin ejecutar la
     * limpieza de React, y una respuesta en streaming puede quedar retenida en
     * el pool de sockets del navegador. Tras seis navegaciones se agota el
     * limite de conexiones por origen de HTTP/1.1 y la aplicacion deja de
     * cargar paginas. Cerrar en `pagehide` libera el socket a tiempo.
     */
    const closeBeforeUnload = (): void => {
      source?.close();
      source = null;
    };

    // Se respeta el transporte que anuncia el servidor. Cuando dice
    // `polling` es porque el stream no es viable en ese despliegue: intentarlo
    // igualmente produciria una reconexion perpetua y ninguna ventaja.
    if (typeof EventSource === 'undefined' || this.info.preferredTransport === 'polling') {
      startPolling();
    } else {
      try {
        source = new EventSource('/api/gps/stream');
        window.addEventListener('pagehide', closeBeforeUnload);
        window.addEventListener('beforeunload', closeBeforeUnload);

        source.addEventListener('open', () => handlers.onTransportChange?.('sse'));

        source.addEventListener('positions', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as LivePositionsPayload;
            handlers.onPositions(payload.positions);
          } catch (error) {
            handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
          }
        });

        source.addEventListener('gps-error', (event) => {
          try {
            const payload = JSON.parse((event as MessageEvent).data) as { message: string };
            handlers.onError?.(new GpsProviderError(payload.message));
          } catch {
            handlers.onError?.(new GpsProviderError('Conexion GPS temporalmente no disponible.'));
          }
        });

        source.addEventListener('error', () => {
          // El navegador reintenta SSE por su cuenta; si la conexion queda
          // cerrada de forma definitiva, se pasa a polling.
          if (source?.readyState === EventSource.CLOSED && !closed) {
            source.close();
            source = null;
            startPolling();
          }
        });
      } catch {
        startPolling();
      }
    }

    return () => {
      closed = true;
      abort.abort();
      window.removeEventListener('pagehide', closeBeforeUnload);
      window.removeEventListener('beforeunload', closeBeforeUnload);
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
      handlers.onTransportChange?.('disconnected');
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
