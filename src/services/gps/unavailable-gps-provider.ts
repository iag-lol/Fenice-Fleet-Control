import 'server-only';

import type {
  DeviceStatus,
  GpsEvent,
  Position,
  Vehicle,
} from '@/types/core';
import type {
  GpsProvider,
  GpsProviderInfo,
  PositionSubscriptionHandlers,
  Unsubscribe,
} from '@/services/gps/gps-provider';

/**
 * Proveedor GPS no disponible.
 *
 * Se usa cuando el proveedor configurado no puede construirse: faltan
 * credenciales, la URL es invalida, el entorno esta a medio configurar.
 *
 * POR QUE EXISTE, en vez de dejar que reviente o caer al simulador:
 *
 *  - Reventar tumbaria TODAS las pantallas por un dato de configuracion.
 *  - Caer al simulador seria mucho peor: la operacion veria camiones
 *    inventados moviendose por el mapa y los tomaria por reales.
 *
 * Asi que no devuelve nada y dice exactamente por que. Un mapa vacio con un
 * motivo claro es honesto; uno lleno de datos falsos, no.
 */
export class UnavailableGpsProvider implements GpsProvider {
  readonly info: GpsProviderInfo;

  constructor(readonly reason: string) {
    this.info = {
      id: 'unavailable',
      label: 'SIN CONEXION',
      simulated: false,
      preferredTransport: 'disconnected',
    };
  }

  async getVehicles(): Promise<Vehicle[]> {
    return [];
  }

  async getVehiclePosition(): Promise<Position | null> {
    return null;
  }

  async getAllCurrentPositions(): Promise<Position[]> {
    return [];
  }

  async getPositionHistory(): Promise<Position[]> {
    return [];
  }

  async getVehicleEvents(): Promise<GpsEvent[]> {
    return [];
  }

  async getDeviceStatus(): Promise<DeviceStatus[]> {
    return [];
  }

  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    handlers.onTransportChange?.('disconnected');
    handlers.onError?.(new Error(this.reason));
    return () => {};
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    return { ok: false, message: this.reason, latencyMs: null };
  }
}
