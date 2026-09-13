import { normalizeGpsHistory } from '@/lib/gps-history';
import { pointOnRoad, roadPathForTransition } from '@/lib/gps-motion';
import { haversineMeters } from '@/lib/geo';
import type { LatLng, Position } from '@/types/core';

/**
 * Reproduccion de una jornada a partir del historial GPS.
 *
 * El motor es puro: recibe posiciones y un instante, y devuelve donde estaba
 * el vehiculo. No sabe de mapas ni de botones. Eso permite probarlo y, sobre
 * todo, que la linea de tiempo y el mapa muestren SIEMPRE lo mismo.
 *
 * Decision central: el eje es el TIEMPO, no el indice de la muestra. Avanzar
 * de muestra en muestra deformaria la realidad — el equipo reporta mas seguido
 * en movimiento que detenido, asi que una hora parado ocuparia lo mismo que
 * dos minutos de marcha.
 */

export interface ReplayFrame {
  signalGap: boolean;
  roadMatched: boolean;
  traveledSegments: LatLng[][];
  /** Instante representado. */
  timestamp: string;
  position: LatLng;
  /** km/h interpolados entre las dos muestras que rodean el instante. */
  speed: number;
  heading: number;
  ignition: Position['ignition'];
  /** Traza recorrida hasta este instante. */
  traveledPath: LatLng[];
  traveledMeters: number;
  /** Indice de la ultima muestra ya ocurrida. */
  sampleIndex: number;
  /** `true` cuando el vehiculo lleva detenido mas del umbral. */
  stopped: boolean;
}

export interface ReplayTimeline {
  startMs: number;
  endMs: number;
  durationMs: number;
  samples: Position[];
  /** Metros acumulados hasta cada muestra. Evita recalcular en cada cuadro. */
  cumulativeMeters: number[];
  totalMeters: number;
}

/** Velocidad por debajo de la cual se considera detenido. */
const STOPPED_SPEED_KMH = 3;

function isContinuous(a: Position, b: Position): boolean {
  const seconds = (Date.parse(b.timestamp) - Date.parse(a.timestamp)) / 1000;
  return seconds > 0 && seconds <= 60 && haversineMeters(a, b) / seconds <= 55;
}

/**
 * Prepara la linea de tiempo.
 *
 * Ordena, descarta muestras sin coordenada util y acumula distancias una sola
 * vez. Devuelve `null` si no hay material suficiente para reproducir nada:
 * es mejor decirlo que mostrar una linea de tiempo vacia que parece rota.
 */
export function buildReplayTimeline(positions: Position[]): ReplayTimeline | null {
  // Las muestras marcadas invalidas por el equipo se descartan: arrastran
  // saltos de kilometros que deformarian la distancia y la reproduccion.
  const samples = normalizeGpsHistory(positions);

  if (samples.length < 2) return null;

  const cumulativeMeters: number[] = [0];
  let total = 0;

  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1]!;
    const current = samples[i]!;
    total += isContinuous(previous, current) ? haversineMeters(
      { lat: previous.lat, lng: previous.lng },
      { lat: current.lat, lng: current.lng },
    ) : 0;
    cumulativeMeters.push(total);
  }

  const startMs = Date.parse(samples[0]!.timestamp);
  const endMs = Date.parse(samples[samples.length - 1]!.timestamp);

  return {
    startMs,
    endMs,
    durationMs: Math.max(1, endMs - startMs),
    samples,
    cumulativeMeters,
    totalMeters: total,
  };
}

/** Ultima muestra cuyo instante es menor o igual a `atMs`. Busqueda binaria. */
function findSampleIndex(timeline: ReplayTimeline, atMs: number): number {
  const { samples } = timeline;
  let low = 0;
  let high = samples.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Date.parse(samples[mid]!.timestamp) <= atMs) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Estado del vehiculo en un instante.
 *
 * Entre dos muestras se interpola: sin eso el camion daria saltos de decenas
 * de metros cada vez que llega un dato, y la reproduccion no serviria para
 * juzgar si el vehiculo se detuvo donde dice.
 */
export function frameAt(timeline: ReplayTimeline, atMs: number): ReplayFrame {
  const { samples, cumulativeMeters } = timeline;
  const clamped = Math.min(Math.max(atMs, timeline.startMs), timeline.endMs);
  const index = findSampleIndex(timeline, clamped);

  const current = samples[index]!;
  const next = samples[index + 1] ?? null;

  const currentMs = Date.parse(current.timestamp);
  const nextMs = next ? Date.parse(next.timestamp) : currentMs;
  const span = nextMs - currentMs;
  const t = span > 0 ? (clamped - currentMs) / span : 0;

  const signalGap = next !== null && span > 60_000;
  const road = next ? roadPathForTransition(current, next) : null;
  // Sin evidencia vial se conserva la ultima muestra, sin dibujar un vuelo
  // recto por edificios. Los cortes de transmision quedan visibles.
  const position = road && t > 0 ? pointOnRoad(road, t) : { lat: current.lat, lng: current.lng };
  const speed = current.speed;
  const traveledPath = samples.slice(0, index + 1).map((p) => ({ lat: p.lat, lng: p.lng }));
  if (road && t > 0) traveledPath.push(position);
  const traveledSegments: LatLng[][] = [];
  let segment: LatLng[] = [];
  for (let i = 0; i <= index; i++) {
    const sample = samples[i]!;
    const previous = samples[i - 1];
    if (previous && !isContinuous(previous, sample)) {
      if (segment.length >= 2) traveledSegments.push(segment);
      segment = [];
    }
    segment.push({ lat: sample.lat, lng: sample.lng });
  }
  if (road && t > 0) segment.push(position);
  if (segment.length >= 2) traveledSegments.push(segment);
  const segmentMeters = road && t > 0 ? haversineMeters(current, position) : 0;

  return {
    signalGap,
    roadMatched: road !== null,
    traveledSegments,
    timestamp: new Date(clamped).toISOString(),
    position,
    speed,
    heading: current.heading,
    ignition: current.ignition,
    traveledPath,
    traveledMeters: (cumulativeMeters[index] ?? 0) + segmentMeters,
    sampleIndex: index,
    stopped: speed < STOPPED_SPEED_KMH,
  };
}

export interface ReplayStop {
  startedAt: string;
  endedAt: string;
  durationSeconds: number;
  position: LatLng;
}

export interface ReplayIgnitionEvent {
  type: 'ignition_on' | 'ignition_off';
  at: string;
  position: LatLng;
}

/**
 * Detenciones de la jornada.
 *
 * Se marcan en la linea de tiempo para poder saltar directamente a ellas: son
 * lo que la operacion quiere revisar (una entrega, una demora en playa, una
 * parada no justificada), no los tramos en marcha.
 */
export function findStops(timeline: ReplayTimeline, minSeconds = 180): ReplayStop[] {
  const stops: ReplayStop[] = [];
  const { samples } = timeline;
  let anchor: number | null = null;

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    const isStopped = sample.speed < STOPPED_SPEED_KMH;

    if (isStopped && anchor === null) anchor = i;

    // Se cierra el tramo al volver a moverse o al agotarse las muestras.
    const isLast = i === samples.length - 1;
    if (anchor !== null && (!isStopped || isLast)) {
      const endIndex = isStopped && isLast ? i : i - 1;
      const from = samples[anchor]!;
      const to = samples[Math.max(anchor, endIndex)]!;
      const seconds = (Date.parse(to.timestamp) - Date.parse(from.timestamp)) / 1000;

      if (seconds >= minSeconds) {
        stops.push({
          startedAt: from.timestamp,
          endedAt: to.timestamp,
          durationSeconds: Math.round(seconds),
          position: { lat: from.lat, lng: from.lng },
        });
      }
      anchor = null;
    }
  }

  return stops;
}

/**
 * Cambios de encendido/apagado durante la jornada.
 *
 * Solo cuentan transiciones confirmadas entre 'on' y 'off': una muestra sin
 * ese dato ('unknown', equipo que no lo reporta) no se toma como cambio hacia
 * ningun lado, para no inventarle un encendido o apagado al equipo que nunca
 * lo confirmo.
 */
export function findIgnitionEvents(timeline: ReplayTimeline): ReplayIgnitionEvent[] {
  const events: ReplayIgnitionEvent[] = [];
  let last: 'on' | 'off' | null = null;

  for (const sample of timeline.samples) {
    if (sample.ignition !== 'on' && sample.ignition !== 'off') continue;

    if (last !== null && sample.ignition !== last) {
      events.push({
        type: sample.ignition === 'on' ? 'ignition_on' : 'ignition_off',
        at: sample.timestamp,
        position: { lat: sample.lat, lng: sample.lng },
      });
    }
    last = sample.ignition;
  }

  return events;
}
