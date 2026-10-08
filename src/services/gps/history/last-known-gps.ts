import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { evaluateConnectionState } from '@/lib/engines/gps-health';
import { isUsableCoordinate } from '@/lib/geo';
import { getOperationalSettings } from '@/services/settings/settings-store';
import type { DeviceStatus, Position, Vehicle } from '@/types/core';
import type { GpsProvider } from '@/services/gps/gps-provider';

interface SavedFleet {
  version: 1;
  vehicles: Vehicle[] | null;
  positions: Position[];
}

/** Conserva datos reales por cuenta; nunca cambia la fecha del GPS. */
export function withLastKnownGps(base: GpsProvider, directory: string, namespace: string): GpsProvider {
  const key = createHash('sha256').update(namespace).digest('hex');
  const filename = resolve(directory, `last-known-${key}.json`);
  let saved: SavedFleet = { version: 1, vehicles: null, positions: [] };
  let loaded: Promise<void> | null = null;
  let writes = Promise.resolve();
  let serialized: string | null = null;
  const warnings = new Map<string, string>();
  const usable = (p: Position): boolean => Boolean(p?.valid) && isUsableCoordinate(p) &&
    Number.isFinite(Date.parse(p.timestamp)) && Date.parse(p.timestamp) <= Date.now() + 60_000;

  const load = () => loaded ??= (async () => {
    try {
      const data = JSON.parse(await readFile(filename, 'utf8')) as SavedFleet;
      if (data.version !== 1 || !Array.isArray(data.positions) ||
        (data.vehicles !== null && !Array.isArray(data.vehicles))) return;
      saved = {
        version: 1,
        vehicles: data.vehicles?.filter((v) => typeof v?.id === 'string' && typeof v?.plate === 'string') ?? null,
        positions: data.positions.filter(usable),
      };
      serialized = JSON.stringify(saved);
    } catch { /* Primera conexión o archivo incompleto: se consulta la fuente real. */ }
  })();

  const persist = async () => {
    const payload = JSON.stringify(saved);
    if (payload === serialized) return;
    const write = writes.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      await writeFile(temporary, payload, { mode: 0o600 });
      await rename(temporary, filename);
      serialized = payload;
    });
    writes = write;
    try { await write; warnings.delete('storage'); }
    catch { warnings.set('storage', 'No fue posible guardar la última ubicación para el siguiente reinicio.'); }
  };

  const rememberedPositions = () => saved.positions.filter((p) =>
    saved.vehicles === null || saved.vehicles.some((v) => v.id === p.vehicleId),
  );
  const remember = async (positions: Position[]) => {
    const latest = new Map(saved.positions.map((p) => [p.vehicleId, p]));
    for (const p of positions.filter(usable)) {
      const previous = latest.get(p.vehicleId);
      if (!previous || Date.parse(p.timestamp) >= Date.parse(previous.timestamp)) latest.set(p.vehicleId, p);
    }
    saved.positions = [...latest.values()];
    await persist();
    return rememberedPositions();
  };
  const getPositions = async () => {
    await load();
    try {
      const positions = await base.getAllCurrentPositions();
      warnings.delete('positions');
      return await remember(positions);
    } catch (error) {
      warnings.set('positions', 'La consulta GPS está temporalmente no disponible. Se conserva la última ubicación registrada.');
      if (!saved.positions.length) throw error;
      return rememberedPositions();
    }
  };

  return {
    info: base.info,
    healthCheck: base.healthCheck?.bind(base),
    getAvailabilityWarnings: () => [...warnings.values()],
    async getVehicles() {
      await load();
      try {
        const vehicles = await base.getVehicles();
        saved.vehicles = vehicles;
        saved.positions = rememberedPositions();
        warnings.delete('vehicles');
        await persist();
        return vehicles;
      } catch (error) {
        warnings.set('vehicles', 'El catálogo GPS está temporalmente no disponible. Se conserva la flota registrada.');
        if (saved.vehicles === null) throw error;
        return saved.vehicles;
      }
    },
    getAllCurrentPositions: getPositions,
    async getVehiclePosition(id) { return (await getPositions()).find((p) => p.vehicleId === id) ?? null; },
    async getDeviceStatus(id) {
      await load();
      try {
        const devices = await base.getDeviceStatus(id);
        warnings.delete('devices');
        if (devices.length) return devices;
      } catch {
        warnings.set('devices', 'El estado GPS se calcula con la fecha de la última posición disponible.');
      }
      const now = new Date();
      const settings = getOperationalSettings().gps;
      return (saved.vehicles ?? []).filter((v) => !id || v.id === id).flatMap((v): DeviceStatus[] => {
        const p = rememberedPositions().find((p) => p.vehicleId === v.id);
        if (!v.device && !p) return [];
        const lastPositionAt = p?.timestamp ?? null;
        const status = evaluateConnectionState(lastPositionAt, settings, now);
        return [{ deviceId: p?.deviceId ?? v.device!.id, vehicleId: v.id,
          connection: status.state, secondsSinceLastPosition: status.secondsSinceLastPosition,
          lastPositionAt, ...(v.device?.imei ? { imei: v.device.imei } : {}) }];
      });
    },
    getPositionHistory: base.getPositionHistory.bind(base),
    getVehicleEvents: base.getVehicleEvents.bind(base),
    subscribeToPositions: (handlers) => base.subscribeToPositions({
      ...handlers,
      onPositions: (positions) => { void load().then(() => remember(positions)).then(handlers.onPositions); },
    }),
  };
}
