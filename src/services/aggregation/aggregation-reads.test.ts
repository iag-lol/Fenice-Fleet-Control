import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GEOFENCE_RULES } from '@/types/core';
import type { Alert, Geofence, Position, Vehicle } from '@/types/core';

const sources = vi.hoisted(() => ({
  gps: { getVehicles: vi.fn(), getAllCurrentPositions: vi.fn(), getDeviceStatus: vi.fn() },
  operations: {
    getVehicles: vi.fn(), getRoutes: vi.fn(), getWorkOrders: vi.fn(), getAlerts: vi.fn(),
    getGeofences: vi.fn(), getDrivers: vi.fn(), getClients: vi.fn(),
  },
}));
vi.mock('@/services/registry', () => ({
  getGpsProvider: () => sources.gps,
  getOperationsProvider: () => sources.operations,
}));
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});

import { loadMapSnapshot } from './dashboard-aggregator';
import { loadFleetTelemetry } from './fleet-aggregator';
import { loadCommuneOperationalSummary } from './commune-aggregator';

const vehicle: Vehicle = {
  id: 'v1' as Vehicle['id'], plate: 'TEST-01', fleetCode: 'F1', brand: 'Volvo', model: 'FH',
  year: 2020, type: 'cisterna_rigido', capacityLiters: 30_000, compartments: 4,
  device: null, driverId: null, depotName: 'Santiago', active: true,
};
const position: Position = {
  vehicleId: vehicle.id, deviceId: 'd1' as Position['deviceId'], timestamp: new Date().toISOString(),
  lat: -33.4489, lng: -70.6693, speed: 0, heading: 0, ignition: 'off', valid: true,
};
const alert: Alert = {
  id: 'a1' as Alert['id'], type: 'gps_offline', category: 'gps', severity: 'warning',
  title: 'Sin señal', description: '', timestamp: position.timestamp, vehicleId: vehicle.id,
  vehiclePlate: vehicle.plate, clientId: null, clientName: null, workOrderId: null,
  workOrderNumber: null, position, state: 'nueva', acknowledgedAt: null, resolvedAt: null, metadata: null,
};

const geofence: Geofence = {
  id: 'g1' as Geofence['id'], name: 'Planta', description: null, kind: 'centro_operacional',
  geometry: { shape: 'circle', center: position, radiusMeters: 150 },
  referenceId: null, clientId: null, routeId: null, vehicleId: null, communeCode: null,
  minDwellSeconds: null, rules: DEFAULT_GEOFENCE_RULES, active: true, color: '#00aabb',
  createdAt: position.timestamp, updatedAt: null, origin: 'manual',
};

describe('single reads within operational responses', () => {
  beforeEach(() => {
    for (const mock of [...Object.values(sources.gps), ...Object.values(sources.operations)]) {
      mock.mockReset().mockResolvedValue([]);
    }
    sources.gps.getVehicles.mockResolvedValue([vehicle]);
    sources.gps.getAllCurrentPositions.mockResolvedValue([position]);
    sources.operations.getAlerts.mockResolvedValue([alert]);
    sources.operations.getGeofences.mockResolvedValue([geofence]);
  });

  it('uses one GPS report for both live positions and vehicle snapshots', async () => {
    const telemetry = await loadFleetTelemetry();
    expect(sources.gps.getAllCurrentPositions).toHaveBeenCalledTimes(1);
    expect(telemetry.positions).toEqual([position]);
    expect(telemetry.vehicles[0]?.position).toBe(telemetry.positions[0]);
    expect(telemetry.vehicles[0]?.vehicle.plate).toBe(vehicle.plate);
    expect(telemetry.vehicles[0]?.openAlertCount).toBe(1);
  });

  it('keeps map alerts and geofences while reading each source only once', async () => {
    const snapshot = await loadMapSnapshot();
    expect(sources.operations.getAlerts).toHaveBeenCalledTimes(1);
    expect(sources.operations.getGeofences).toHaveBeenCalledTimes(1);
    expect(sources.operations.getAlerts).toHaveBeenCalledWith({ states: ['nueva', 'revisada'] });
    expect(snapshot.alerts[0]?.alertId).toBe(alert.id);
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.geofences).toEqual([geofence]);
  });

  it('counts georeferenced alerts and vehicles in communes without a second alerts query', async () => {
    const summary = await loadCommuneOperationalSummary();
    expect(sources.operations.getAlerts).toHaveBeenCalledTimes(1);
    expect(Object.values(summary).reduce((sum, c) => sum + c.openAlerts, 0)).toBe(1);
    expect(Object.values(summary).reduce((sum, c) => sum + c.vehiclesInside, 0)).toBe(1);
  });
});
