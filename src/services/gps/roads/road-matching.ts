import 'server-only';
import { getServerEnv } from '@/config/env';
import { haversineMeters, isUsableCoordinate } from '@/lib/geo';
import type { Position } from '@/types/core';

interface MatchResponse {
  code: string;
  tracepoints?: ({ matchings_index: number } | null)[];
  matchings?: { confidence: number; geometry: { coordinates: number[][] } }[];
}

/** No usa servidores publicos por defecto ni sustituye el registro GPS original. */
export async function matchRoadSegment(previous: Position, next: Position, baseUrl: string): Promise<Position['roadMatch']> {
  const seconds = (Date.parse(next.timestamp) - Date.parse(previous.timestamp)) / 1000;
  const distance = haversineMeters(previous, next);
  if (!previous.valid || !next.valid || !isUsableCoordinate(previous) || !isUsableCoordinate(next) ||
    seconds <= 0 || seconds > 60 || distance < 3 || distance / seconds > 55 ||
    (previous.accuracy ?? 0) > 50 || (next.accuracy ?? 0) > 50) return;
  const coordinates = `${previous.lng},${previous.lat};${next.lng},${next.lat}`;
  const params = new URLSearchParams({
    geometries: 'geojson', overview: 'full', gaps: 'split', tidy: 'false',
    timestamps: `${Math.floor(Date.parse(previous.timestamp) / 1000)};${Math.floor(Date.parse(next.timestamp) / 1000)}`,
    radiuses: `${Math.max(5, previous.accuracy ?? 15)};${Math.max(5, next.accuracy ?? 15)}`,
  });
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/match/v1/driving/${coordinates}?${params}`, {
      cache: 'no-store', signal: AbortSignal.timeout(1800),
    });
    if (!response.ok) return;
    const data = await response.json() as MatchResponse;
    const match = data.matchings?.[0];
    if (data.code !== 'Ok' || data.matchings?.length !== 1 || !match || match.confidence < 0.8 ||
      data.tracepoints?.length !== 2 || !data.tracepoints.every((p) => p?.matchings_index === 0)) return;
    const path = match.geometry.coordinates.map(([lng, lat]) => ({ lat: lat!, lng: lng! }));
    if (path.length < 2 || !path.every(isUsableCoordinate) ||
      haversineMeters(path[0]!, previous) > 35 || haversineMeters(path.at(-1)!, next) > 35) return;
    const meters = path.slice(1).reduce((sum, point, i) => sum + haversineMeters(path[i]!, point), 0);
    if (meters > Math.max(distance * 3, 150) || meters / seconds > 55) return;
    return { fromTimestamp: previous.timestamp, confidence: match.confidence, path };
  } catch { return; }
}

const recent = new Map<string, Position>();
let enriching: Promise<Position[]> | null = null;

export async function addRoadMatches(positions: Position[]): Promise<Position[]> {
  const url = getServerEnv().OSRM_BASE_URL;
  if (!url) return positions;
  // Las peticiones concurrentes no comparten respuestas de otra muestra.
  
  const work = async (): Promise<Position[]> => {
    const results = [...positions];
    let cursor = 0;
    const worker = async () => {
      while (cursor < positions.length) {
        const index = cursor++;
        const position = positions[index]!;
        const previous = recent.get(position.vehicleId);
        let roadMatch = previous?.timestamp === position.timestamp ? previous.roadMatch : undefined;
        if (previous && Date.parse(position.timestamp) > Date.parse(previous.timestamp)) {
          roadMatch = await matchRoadSegment(previous, position, url);
        }
        const result = { ...position, ...(roadMatch ? { roadMatch } : {}) };
        results[index] = result;
        if (!previous || Date.parse(position.timestamp) >= Date.parse(previous.timestamp)) recent.set(position.vehicleId, result);
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, positions.length) }, worker));
    if (recent.size > 2000) {
      const active = new Set<string>(positions.map((p) => p.vehicleId));
      for (const id of recent.keys()) if (!active.has(id)) recent.delete(id);
    }
    return results;
  };
  const pending = (enriching ?? Promise.resolve()).then(work);
  enriching = pending;
  try { return await pending; } finally { if (enriching === pending) enriching = null; }
}
