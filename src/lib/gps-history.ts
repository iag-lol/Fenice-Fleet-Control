import { isUsableCoordinate } from '@/lib/geo';
import type { Position } from '@/types/core';

/** Conserva extremos y orden sin modificar las muestras originales del proveedor. */
export function normalizeGpsHistory(positions: Position[], limit = 20_000): Position[] {
  const unique = new Map<string, Position>();
  const rejected = new Map<string, number[]>();
  for (const p of positions) {
    const time = Date.parse(p.timestamp);
    if (!Number.isFinite(time)) continue;
    if (!p.valid || !isUsableCoordinate(p)) {
      const times = rejected.get(p.vehicleId) ?? [];
      times.push(time);
      rejected.set(p.vehicleId, times);
      continue;
    }
    unique.set(`${p.vehicleId}:${p.timestamp}`, p);
  }
  const previous = new Map<string, number>();
  for (const times of rejected.values()) times.sort((a, b) => a - b);
  const rejectedCursor = new Map<string, number>();
  const sorted = [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).map((p) => {
    const time = Date.parse(p.timestamp), from = previous.get(p.vehicleId);
    previous.set(p.vehicleId, time);
    const times = rejected.get(p.vehicleId) ?? [];
    let cursor = rejectedCursor.get(p.vehicleId) ?? 0;
    while (cursor < times.length && times[cursor]! <= (from ?? time)) cursor++;
    const broken = from !== undefined && (times[cursor] ?? Infinity) < time;
    rejectedCursor.set(p.vehicleId, cursor);
    return broken ? { ...p, historyGapBefore: true } : p;
  });
  if (sorted.length <= limit) return sorted;
  if (limit <= 1) return sorted.slice(-1);
  let previousIndex = -1;
  return Array.from({ length: limit }, (_, i) => {
    const index = Math.round(i * (sorted.length - 1) / (limit - 1));
    const p = sorted[index]!;
    const broken = sorted.slice(previousIndex + 1, index + 1).some((sample) => sample.historyGapBefore);
    previousIndex = index;
    return broken ? { ...p, historyGapBefore: true } : p;
  });
}
