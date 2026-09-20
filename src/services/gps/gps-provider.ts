import type {
  DeviceStatus,
  GpsEvent,
  IsoDateTime,
  Position,
  Vehicle,
  VehicleId,
} from '@/types/core';
import type { LivePositionsPayload } from '@/types/views';

/**
 * Contrato UNICO de telemetria GPS.
 *
 * Toda la aplicacion consume esta interfaz. Ningun componente, hook o ruta
 * importa datos mock ni el cliente de Traccar directamente. Cambiar de
 * proveedor debe ser cambiar una variable de entorno, no tocar la UI.
 */

export interface PositionHistoryQuery {
  vehicleId: VehicleId;
  from: IsoDateTime;
  to: IsoDateTime;
  /** Limite de muestras devueltas. El proveedor puede submuestrear. */
  limit?: number;
}

export interface VehicleEventsQuery {
  vehicleId?: VehicleId;
  from?: IsoDateTime;
  to?: IsoDateTime;
  limit?: number;
}

/** Cancelador devuelto por la suscripcion en vivo. */
export type Unsubscribe = () => void;

export interface PositionSubscriptionHandlers {
  onPositions: (positions: Position[]) => void;
  /**
   * Instantanea completa que acompana la transmision HTTP/SSE.
   *
   * Los proveedores nativos pueden omitirla; el proxy del navegador la usa
   * para actualizar estados, asignaciones y contadores en el mismo pulso que
   * las coordenadas, sin esperar el siguiente refetch de React Query.
   */
  onSnapshot?: (payload: LivePositionsPayload) => void;
  onError?: (error: Error) => void;
  /** Se dispara cuando cambia el transporte activo (ws / sse / polling). */
  onTransportChange?: (transport: GpsTransport) => void;
}

export type GpsTransport = 'websocket' | 'sse' | 'polling' | 'disconnected';

export interface GpsProviderInfo {
  /** Identificador tecnico del proveedor activo. */
  id: 'mock' | 'traccar' | '3dtracking' | 'unavailable';
  /** Etiqueta mostrada en el indicador de modo del header. */
  label: string;
  /** `true` cuando los datos provienen de un simulador. */
  simulated: boolean;
  /** Transporte preferente que el proveedor intentara usar. */
  preferredTransport: GpsTransport;
}

export interface GpsProvider {
  readonly info: GpsProviderInfo;

  /** Vehiculos conocidos por la fuente de telemetria. */
  getVehicles(): Promise<Vehicle[]>;

  /** Ultima posicion conocida de un vehiculo. */
  getVehiclePosition(vehicleId: VehicleId): Promise<Position | null>;

  /** Ultima posicion conocida de toda la flota. */
  getAllCurrentPositions(): Promise<Position[]>;

  /** Historial de posiciones en una ventana temporal. */
  getPositionHistory(query: PositionHistoryQuery): Promise<Position[]>;

  /** Eventos reportados por los equipos. */
  getVehicleEvents(query: VehicleEventsQuery): Promise<GpsEvent[]>;

  /** Estado de conexion de un equipo, o de todos si se omite el id. */
  getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]>;

  /**
   * Suscripcion en vivo. La implementacion elige el mejor transporte
   * disponible y degrada a polling sin que el consumidor se entere.
   */
  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe;

  /** Diagnostico opcional para `/api/system/gps`: no todos los proveedores lo implementan. */
  healthCheck?(): Promise<{ ok: boolean; message: string; latencyMs: number | null }>;
}

/** Error tipado para que la UI distinga fallas de telemetria de otras. */
export class GpsProviderError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
    /** Ultima marca de tiempo con datos validos, para el mensaje de la UI. */
    readonly lastKnownAt?: IsoDateTime | null,
  ) {
    super(message);
    this.name = 'GpsProviderError';
  }
}
