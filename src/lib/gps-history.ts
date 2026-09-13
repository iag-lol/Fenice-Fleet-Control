import { isUsableCoordinate } from '@/lib/geo';
import type { Position } from '@/types/core';

/** Conserva extremos y orden sin modificar las muestras originales del proveedor. */
export function normalizeGpsHistory(positions: Position[], limit = 20_000): Position[] {
  const unique = new Map<string, Position>();
  for (const p of positions) {
    if (!p.valid || !isUsableCoordinate(p) || !Number.isFinite(Date.parse(p.timestamp))) continue;
    unique.set(`${p.vehicleId}:${p.timestamp}`, p);
  }
  const sorted = [...unique.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (sorted.length <= limit) return sorted;
  if (limit <= 1) return sorted.slice(-1);
  return Array.from({ length: limit }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (limit - 1))]!);
}
