import 'server-only';

import { getOperationalSettings } from '@/services/settings/settings-store';
import { getDemoDataset as getDataset } from '@/demo';
import { evaluateConnectionState } from '@/lib/engines/gps-health';
import { fleetSimulator, SIMULATOR_TICK_MS } from '@/services/gps/mock/simulator';
import type {
  GpsProvider,
  GpsProviderInfo,
  PositionHistoryQuery,
  PositionSubscriptionHandlers,
  Unsubscribe,
  VehicleEventsQuery,
} from '@/services/gps/gps-provider';
import type { DeviceStatus, GpsEvent, Position, Vehicle, VehicleId } from '@/types/core';

/**
 * Proveedor GPS de demostracion. Traduce el estado del simulador al contrato
 * `GpsProvider`, exactamente igual que hara `TraccarGpsProvider` con las
 * respuestas del servidor real.
 */
export class MockGpsProvider implements GpsProvider {
  readonly info: GpsProviderInfo = {
    id: 'mock',
    label: 'DEMO',
    simulated: true,
    preferredTransport: 'polling',
  };

  async getVehicles(): Promise<Vehicle[]> {
    return getDataset().vehicles;
  }

  async getVehiclePosition(vehicleId: VehicleId): Promise<Position | null> {
    return fleetSimulator.getPosition(vehicleId);
  }

  async getAllCurrentPositions(): Promise<Position[]> {
    return fleetSimulator.getCurrentPositions();
  }

  async getPositionHistory(query: PositionHistoryQuery): Promise<Position[]> {
    return fleetSimulator.getHistory(
      query.vehicleId,
      new Date(query.from),
      new Date(query.to),
      query.limit,
    );
  }

  async getVehicleEvents(query: VehicleEventsQuery): Promise<GpsEvent[]> {
    const events = fleetSimulator.getEvents(query.vehicleId, query.limit ?? 100);
    if (!query.from && !query.to) return events;

    const fromMs = query.from ? new Date(query.from).getTime() : Number.NEGATIVE_INFINITY;
    const toMs = query.to ? new Date(query.to).getTime() : Number.POSITIVE_INFINITY;

    return events.filter((e) => {
      const ms = new Date(e.timestamp).getTime();
      return ms >= fromMs && ms <= toMs;
    });
  }

  async getDeviceStatus(vehicleId?: VehicleId): Promise<DeviceStatus[]> {
    const dataset = getDataset();
    const gps = getOperationalSettings().gps;
    const now = new Date();

    return dataset.vehicles
      .filter((v) => v.device !== null && (!vehicleId || v.id === vehicleId))
      .map((vehicle) => {
        const device = vehicle.device!;
        const lastPositionAt = fleetSimulator.getLastKnownAt(vehicle.id);
        const { state, secondsSinceLastPosition } = evaluateConnectionState(lastPositionAt, gps, now);

        return {
          deviceId: device.id,
          vehicleId: vehicle.id,
          imei: device.imei,
          connection: state,
          lastPositionAt,
          secondsSinceLastPosition,
          protocol: 'teltonika',
          model: device.model,
        } satisfies DeviceStatus;
      });
  }

  subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
    handlers.onTransportChange?.('polling');

    const emit = (): void => {
      try {
        handlers.onPositions(fleetSimulator.getCurrentPositions());
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    };

    emit();
    const timer = setInterval(emit, SIMULATOR_TICK_MS);

    return () => {
      clearInterval(timer);
      handlers.onTransportChange?.('disconnected');
    };
  }
}
