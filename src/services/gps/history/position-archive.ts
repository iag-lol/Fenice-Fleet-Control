import 'server-only';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { addRoadMatches } from '@/services/gps/roads/road-matching';
import { normalizeGpsHistory } from '@/lib/gps-history';
import type { Position } from '@/types/core';
import type { GpsProvider, PositionHistoryQuery } from '@/services/gps/gps-provider';

/** Archivo de muestras originales. En despliegues debe apuntar a un volumen persistente. */
export class PositionArchive {
  private writes = Promise.resolve();
  private latest = new Map<string, string>();
  constructor(private directory: string, private namespace: string) {}

  private filename(vehicleId: string, day: string): string {
    const key = createHash('sha256').update(`${this.namespace}:${vehicleId}`).digest('hex');
    return resolve(this.directory, `${key}-${day}.jsonl`);
  }

  record(positions: Position[]): Promise<void> {
    const write = this.writes.catch(() => {}).then(async () => {
      const groups = new Map<string, Position[]>();
      for (const position of normalizeGpsHistory(positions)) {
        const day = new Date(position.timestamp).toISOString().slice(0, 10);
        const original = position;
        const fingerprint = JSON.stringify(original);
        if (this.latest.get(position.vehicleId) === fingerprint) continue;
        const file = this.filename(position.vehicleId, day);
        const group = groups.get(file) ?? [];
        group.push(original); groups.set(file, group);
      }
      if (groups.size === 0) return;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      for (const [file, samples] of groups) {
        await appendFile(file, '\n' + samples.map((p) => JSON.stringify(p)).join('\n') + '\n', { mode: 0o600 });
        for (const p of samples) this.latest.set(p.vehicleId, JSON.stringify(p));
      }
    });
    this.writes = write;
    return write;
  }

  async read(query: PositionHistoryQuery): Promise<Position[]> {
    await this.writes.catch(() => {});
    const from = Date.parse(query.from); const to = Date.parse(query.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 72 * 3_600_000) return [];
    const positions: Position[] = [];
    for (let day = Math.floor(from / 86_400_000); day <= Math.floor(to / 86_400_000); day++) {
      const file = this.filename(query.vehicleId, new Date(day * 86_400_000).toISOString().slice(0, 10));
      try {
        for (const line of (await readFile(file, 'utf8')).split('\n')) {
          try {
            const p = JSON.parse(line) as Position;
            const time = Date.parse(p.timestamp);
            if (p.vehicleId === query.vehicleId && time >= from && time <= to) positions.push(p);
          } catch { /* Tolera una ultima linea interrumpida por un reinicio. */ }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return normalizeGpsHistory(positions, query.limit);
  }
}

export function withPositionArchive(provider: GpsProvider, archive: PositionArchive): GpsProvider {
  const record = async (positions: Position[]) => {
    const real = positions.filter((p) => p.simulated === false || (!provider.info.simulated && p.simulated !== true));
    if (real.length) {
      try { await archive.record(real); }
      catch (error) { console.error('[gps-history] No se pudo guardar el recorrido:', error instanceof Error ? error.message : error); }
    }
    return positions;
  };
  return {
    info: provider.info,
    getVehicles: () => provider.getVehicles(),
    getDeviceStatus: (id) => provider.getDeviceStatus(id),
    getVehicleEvents: (query) => provider.getVehicleEvents(query),
    getAllCurrentPositions: async () => record(await addRoadMatches(await provider.getAllCurrentPositions())),
    getVehiclePosition: async (id) => {
      const position = await provider.getVehiclePosition(id);
      if (position) return (await record(await addRoadMatches([position])))[0] ?? position;
      return position;
    },
    async getPositionHistory(query) {
      const [remote, local] = await Promise.allSettled([provider.getPositionHistory(query), archive.read(query)]);
      if (remote.status === 'rejected' && (local.status === 'rejected' || !local.value.length)) throw remote.reason;
      const source = remote.status === 'fulfilled' ? remote.value : [];
      const localPositions = local.status === 'fulfilled' ? local.value : [];
      const localByKey = new Map(localPositions.map((p) => [`${p.vehicleId}:${p.timestamp}`, p]));
      // Solo respalda muestras que aun no estan archivadas; consultar varias
      // veces la misma jornada no debe multiplicar el archivo indefinidamente.
      await record(source.filter((p) => {
        const saved = localByKey.get(`${p.vehicleId}:${p.timestamp}`);
        return !saved || saved.lat !== p.lat || saved.lng !== p.lng;
      }));
      // La fuente tiene prioridad al corregir una muestra ya archivada.
      const matchedByKey = new Map(localPositions.filter((p) => p.roadMatch)
        .map((p) => [`${p.vehicleId}:${p.timestamp}`, p]));
      return normalizeGpsHistory([...localPositions, ...source.map((p) => {
        const archived = matchedByKey.get(`${p.vehicleId}:${p.timestamp}`);
        return archived?.lat === p.lat && archived.lng === p.lng ? { ...p, roadMatch: archived.roadMatch } : p;
      })], query.limit);
    },
    subscribeToPositions: (handlers) => provider.subscribeToPositions({ ...handlers,
      onPositions: (positions) => { void record(positions).then(handlers.onPositions); },
    }),
  };
}
