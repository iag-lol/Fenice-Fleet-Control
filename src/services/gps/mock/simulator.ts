import 'server-only';

import { getDemoDataset as getDataset } from '@/demo';
import { SeededRandom } from '@/demo/random';
import { COMMUNES } from '@/data/communes';
import { destinationPoint, haversineMeters, interpolate, bearingDegrees } from '@/lib/geo';
import { resolveCommune } from '@/lib/engines/route-compliance';
import {
  asDeviceId,
  type GpsEvent,
  type GpsEventType,
  type LatLng,
  type Position,
  type Route,
  type Vehicle,
  type VehicleId,
} from '@/types/core';

/**
 * Simulador de flota.
 *
 * Reemplaza al servidor Traccar mientras no exista hardware instalado. Mueve
 * cada vehiculo por su corredor planificado, genera detenciones en las
 * geocercas de los clientes, provoca desvios y perdidas de senal ocasionales,
 * y mantiene un historial consultable.
 *
 * Decision de diseno: el simulador avanza con el tiempo REAL transcurrido
 * desde su arranque, no con la hora del dia. Asi la demostracion se ve viva a
 * cualquier hora, que es lo que se necesita para presentar la plataforma.
 *
 * Es un singleton de proceso: el proveedor GPS, las rutas de API y el stream
 * SSE observan exactamente el mismo estado.
 */

const TICK_MS = 15_000;
/** Historial retenido por vehiculo. 8 h a 15 s por muestra. */
const MAX_HISTORY_SAMPLES = 1_920;
const MAX_EVENTS = 400;
/** Historial precargado al arrancar, para que los graficos no nazcan vacios. */
const BACKFILL_MINUTES = 150;

type SimMode =
  | 'en_base'
  | 'conduciendo'
  | 'en_parada'
  | 'detenido'
  | 'desviado'
  | 'finalizado'
  | 'sin_senal';

interface StopAnchor {
  sequence: number;
  /** Distancia acumulada sobre el corredor a la que se encuentra la parada. */
  alongMeters: number;
  /** Visitada en el recorrido en curso. Se reinicia en cada turno. */
  visited: boolean;
  /**
   * Visitada alguna vez. Es lo que consume el estado de las OT: una entrega
   * detectada no puede "des-ocurrir" porque el vehiculo inicie otro turno.
   */
  visitedEver: boolean;
}

interface VehicleSimState {
  vehicleId: VehicleId;
  deviceId: string;
  routeId: string | null;
  path: LatLng[];
  /** Distancia acumulada en metros hasta cada vertice del corredor. */
  cumulative: number[];
  totalMeters: number;
  alongMeters: number;
  speedKmh: number;
  heading: number;
  mode: SimMode;
  /** Instante (epoch ms) en el que termina el modo actual. */
  modeUntil: number;
  stops: StopAnchor[];
  /** Desplazamiento lateral respecto del corredor, en metros. */
  lateralOffset: number;
  lateralBearing: number;
  odometerKm: number;
  ignitionOn: boolean;
  history: Position[];
  events: GpsEvent[];
  /** Geocercas en las que el vehiculo se encuentra actualmente. */
  insideGeofences: Set<string>;
  /** Perfil de comportamiento asignado de forma determinista. */
  profile: 'normal' | 'desviado' | 'detencion_larga' | 'sin_senal';
  /** Instante (epoch ms) en que el vehiculo sale de base. */
  startsAtMs: number;
  rng: SeededRandom;
}

function buildCumulative(path: LatLng[]): { cumulative: number[]; total: number } {
  const cumulative: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += haversineMeters(path[i - 1]!, path[i]!);
    cumulative.push(total);
  }
  return { cumulative, total };
}

/** Punto sobre el corredor a `alongMeters` del inicio, con su rumbo. */
function pointAt(
  path: LatLng[],
  cumulative: number[],
  alongMeters: number,
): { point: LatLng; heading: number } {
  if (path.length === 0) return { point: { lat: 0, lng: 0 }, heading: 0 };
  if (path.length === 1) return { point: path[0]!, heading: 0 };

  const clamped = Math.max(0, Math.min(cumulative[cumulative.length - 1]!, alongMeters));

  // Busqueda binaria del segmento contenedor.
  let low = 0;
  let high = cumulative.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (cumulative[mid]! <= clamped) low = mid;
    else high = mid;
  }

  const a = path[low]!;
  const b = path[high]!;
  const segmentLength = cumulative[high]! - cumulative[low]!;
  const t = segmentLength === 0 ? 0 : (clamped - cumulative[low]!) / segmentLength;

  return { point: interpolate(a, b, t), heading: bearingDegrees(a, b) };
}

function nearestAlongMeters(path: LatLng[], cumulative: number[], target: LatLng): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < path.length; i += 1) {
    const distance = haversineMeters(path[i]!, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cumulative[i]!;
    }
  }
  return best;
}

/** Velocidad urbana media asumida por el simulador, en km/h. */
const AVERAGE_SPEED_KMH = 42;
/** Minutos de permanencia media por entrega. */
const AVERAGE_STOP_MINUTES = 13;
/** Descanso en base antes de iniciar un nuevo turno. */
const SHIFT_REST_MINUTES = { min: 14, max: 28 };

/**
 * Duracion estimada de un turno completo: conduccion mas permanencia en las
 * entregas. Sirve para escalonar las salidas de modo que, al momento de abrir
 * la plataforma, la flota este repartida a lo largo de sus rutas.
 */
function estimateShiftMinutes(totalMeters: number, stopCount: number): number {
  const drivingMinutes = (totalMeters / 1000 / AVERAGE_SPEED_KMH) * 60;
  return Math.max(20, drivingMinutes + stopCount * AVERAGE_STOP_MINUTES);
}

export interface SimulatorStatus {
  running: boolean;
  paused: boolean;
  startedAt: string;
  lastTickAt: string | null;
  tickIntervalMs: number;
  vehicleCount: number;
  /** Modo actual por vehiculo, util para el panel de diagnostico. */
  modes: Record<string, SimMode>;
}

class FleetSimulator {
  private states = new Map<string, VehicleSimState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private paused = false;
  private startedAt = new Date();
  private lastTickAt: Date | null = null;
  private initialized = false;

  /** Arranca el simulador. Idempotente. */
  start(): void {
    if (this.initialized) {
      this.ensureTimer();
      return;
    }
    this.initialized = true;
    this.seedStates();
    this.backfillHistory();
    this.ensureTimer();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(new Date()), TICK_MS);
    // No mantener vivo el proceso solo por el simulador.
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getStatus(): SimulatorStatus {
    this.start();
    const modes: Record<string, SimMode> = {};
    for (const [id, state] of this.states) modes[id] = state.mode;

    return {
      running: this.timer !== null,
      paused: this.paused,
      startedAt: this.startedAt.toISOString(),
      lastTickAt: this.lastTickAt?.toISOString() ?? null,
      tickIntervalMs: TICK_MS,
      vehicleCount: this.states.size,
      modes,
    };
  }

  // -------------------------------------------------------------------------
  // Inicializacion
  // -------------------------------------------------------------------------

  private seedStates(): void {
    const dataset = getDataset();
    const startedAtMs = Date.now();
    const routeByVehicle = new Map<string, Route>();
    for (const route of dataset.routes) {
      if (route.vehicleId) routeByVehicle.set(route.vehicleId, route);
    }

    const routable = dataset.vehicles.filter((v): v is Vehicle & { device: NonNullable<Vehicle['device']> } =>
      v.device !== null,
    );

    routable.forEach((vehicle, index) => {
      const rng = new SeededRandom(dataset.seed + index * 7919);
      const route = routeByVehicle.get(vehicle.id) ?? null;

      const path = route?.plannedPath ?? [];
      const { cumulative, total } = buildCumulative(path);

      // Perfiles asignados de forma estable para que la demo muestre siempre
      // los casos operacionales interesantes: un desvio, una detencion larga
      // y una perdida de senal.
      const profile: VehicleSimState['profile'] =
        index === 1 ? 'desviado' : index === 3 ? 'detencion_larga' : index === routable.length - 1 ? 'sin_senal' : 'normal';

      const stops: StopAnchor[] = (route?.stops ?? []).map((stop) => ({
        sequence: stop.sequence,
        alongMeters: nearestAlongMeters(path, cumulative, stop.coordinates ?? path[0] ?? { lat: 0, lng: 0 }),
        visited: false,
        visitedEver: false,
      }));

      // Salidas escalonadas, no posiciones escalonadas.
      //
      // Todos los vehiculos parten de su base con la ruta intacta; lo que
      // difiere es CUANDO salen. Al reproducir el pasado reciente, la flota
      // queda repartida de forma realista: algunos terminando, otros a mitad
      // de ruta, otros recien saliendo y alguno aun en base. Sembrar
      // directamente posiciones intermedias producia recorridos incoherentes
      // (kilometraje y paradas que nadie habia recorrido).
      const shiftMinutes = estimateShiftMinutes(total, stops.length);
      const startsAtMs = startedAtMs - shiftMinutes * 60_000 * rng.float(0.12, 1.05);

      const state: VehicleSimState = {
        vehicleId: vehicle.id,
        deviceId: vehicle.device.id,
        routeId: route?.id ?? null,
        path,
        cumulative,
        totalMeters: total,
        alongMeters: 0,
        speedKmh: 0,
        heading: 0,
        mode: 'en_base',
        modeUntil: 0,
        stops,
        lateralOffset: 0,
        lateralBearing: 0,
        odometerKm: rng.int(40_000, 320_000),
        ignitionOn: false,
        history: [],
        events: [],
        insideGeofences: new Set(),
        profile,
        startsAtMs,
        rng,
      };

      this.states.set(vehicle.id, state);
    });
  }

  /**
   * Reproduce el pasado reciente para que el historial no nazca vacio y la
   * flota quede repartida a lo largo de sus rutas.
   *
   * Cada vehiculo arranca en base con la ruta intacta y sale en el instante
   * que le asigno `seedStates()`. La reproduccion hacia adelante hace el
   * resto: el estado resultante es el que produciria una jornada real.
   */
  private backfillHistory(): void {
    const now = Date.now();
    const ticks = Math.floor((BACKFILL_MINUTES * 60_000) / TICK_MS);

    for (let i = ticks; i > 0; i -= 1) {
      this.tick(new Date(now - i * TICK_MS), { silent: true });
    }
  }

  // -------------------------------------------------------------------------
  // Avance
  // -------------------------------------------------------------------------

  private tick(at: Date, options: { silent?: boolean } = {}): void {
    if (this.paused && !options.silent) return;

    for (const state of this.states.values()) {
      this.advanceVehicle(state, at);
    }
    this.lastTickAt = at;
  }

  private advanceVehicle(state: VehicleSimState, at: Date): void {
    const nowMs = at.getTime();
    const deltaSeconds = TICK_MS / 1000;

    if (state.path.length < 2) return;

    // --- En base, esperando su hora de salida --------------------------------
    if (state.mode === 'en_base') {
      if (nowMs < state.startsAtMs) {
        state.speedKmh = 0;
        state.ignitionOn = false;
        this.pushPosition(state, at);
        return;
      }
      // Todos salen conduciendo. El vehiculo con perfil de mala cobertura
      // pierde y recupera la senal durante el trayecto (con su `modeUntil`
      // correspondiente); arrancarlo ya mudo lo dejaria silencioso para
      // siempre, que no es el caso operacional que interesa mostrar.
      state.mode = 'conduciendo';
      state.ignitionOn = true;
      this.pushEvent(state, 'ignition_on', at, 'Inicio de ruta');
    }

    // --- Transiciones de modo -------------------------------------------------
    if (state.modeUntil > 0 && nowMs >= state.modeUntil) {
      if (state.mode === 'en_parada' || state.mode === 'detenido') {
        state.mode = 'conduciendo';
        state.ignitionOn = true;
      } else if (state.mode === 'desviado') {
        state.mode = 'conduciendo';
        state.lateralOffset = 0;
        this.pushEvent(state, 'ignition_on', at, 'Retorno al corredor planificado');
      } else if (state.mode === 'sin_senal') {
        state.mode = 'conduciendo';
        this.pushEvent(state, 'device_online', at, 'Senal recuperada');
      }
      state.modeUntil = 0;
    }

    // El vehiculo sin senal no reporta: es exactamente lo que ocurre en campo.
    if (state.mode === 'sin_senal') return;

    // --- Fin de turno: descanso en base y nuevo turno -------------------------
    //
    // Un vehiculo que termina su ruta y se queda estacionado para siempre
    // vaciaria la demostracion en menos de dos horas. Tras un descanso vuelve
    // a salir, como haria en un segundo turno. Las paradas ya visitadas
    // conservan su marca acumulada: una entrega detectada no se deshace.
    if (state.mode === 'finalizado') {
      if (state.modeUntil > 0 && nowMs >= state.modeUntil) {
        state.alongMeters = 0;
        state.modeUntil = 0;
        state.mode = 'conduciendo';
        state.ignitionOn = true;
        state.insideGeofences.clear();
        for (const stop of state.stops) stop.visited = false;
        this.pushEvent(state, 'ignition_on', at, 'Inicio de nuevo turno');
      } else {
        state.speedKmh = 0;
        state.ignitionOn = false;
        this.pushPosition(state, at);
        return;
      }
    }

    // --- Avance --------------------------------------------------------------
    if (state.mode === 'conduciendo' || state.mode === 'desviado') {
      // Velocidad urbana con variacion suave, no un valor constante irreal.
      const target = state.rng.normal(42, 14, 8, 78);
      state.speedKmh = state.speedKmh + (target - state.speedKmh) * 0.45;
      const advance = (state.speedKmh / 3.6) * deltaSeconds;
      state.alongMeters += advance;
      state.odometerKm += advance / 1000;
      state.ignitionOn = true;
    } else {
      state.speedKmh = 0;
      state.ignitionOn = state.mode === 'en_parada';
    }

    // --- Llegada a parada ----------------------------------------------------
    if (state.mode === 'conduciendo') {
      const pending = state.stops.find((s) => !s.visited);
      if (pending && state.alongMeters >= pending.alongMeters) {
        pending.visited = true;
        pending.visitedEver = true;
        state.alongMeters = pending.alongMeters;
        state.mode = 'en_parada';
        // Permanencia realista de entrega: entre 4 y 22 minutos.
        state.modeUntil = nowMs + state.rng.int(240, 1_320) * 1000;
        state.speedKmh = 0;
      }
    }

    // --- Fin de recorrido ----------------------------------------------------
    if (state.alongMeters >= state.totalMeters) {
      state.alongMeters = state.totalMeters;
      state.mode = 'finalizado';
      state.modeUntil =
        nowMs + state.rng.int(SHIFT_REST_MINUTES.min, SHIFT_REST_MINUTES.max) * 60_000;
      state.speedKmh = 0;
      state.ignitionOn = false;
      this.pushEvent(state, 'ignition_off', at, 'Fin de ruta - retorno a base');
    }

    // --- Eventos aleatorios ---------------------------------------------------
    if (state.mode === 'conduciendo' && state.modeUntil === 0) {
      const roll = state.rng.next();

      if (state.profile === 'desviado' && roll < 0.05) {
        state.mode = 'desviado';
        state.modeUntil = nowMs + state.rng.int(180, 420) * 1000;
        state.lateralOffset = state.rng.int(380, 900);
        state.lateralBearing = (state.heading + (state.rng.bool() ? 90 : -90) + 360) % 360;
        this.pushEvent(state, 'harsh_braking', at, 'Salida del corredor planificado');
      } else if (state.profile === 'detencion_larga' && roll < 0.04) {
        state.mode = 'detenido';
        state.modeUntil = nowMs + state.rng.int(900, 2_100) * 1000;
        this.pushEvent(state, 'idle_start', at, 'Detencion prolongada fuera de geocerca');
      } else if (state.profile === 'sin_senal' && roll < 0.02) {
        state.mode = 'sin_senal';
        state.modeUntil = nowMs + state.rng.int(600, 1_500) * 1000;
        this.pushEvent(state, 'device_offline', at, 'Perdida de comunicacion con el equipo');
      } else if (roll > 0.985) {
        this.pushEvent(state, 'overspeed', at, 'Exceso de velocidad puntual');
      }
    }

    this.pushPosition(state, at);
  }

  private pushPosition(state: VehicleSimState, at: Date): void {
    const { point, heading } = pointAt(state.path, state.cumulative, state.alongMeters);
    state.heading = heading;

    // El desvio se materializa como desplazamiento lateral real respecto del
    // corredor, de modo que el motor de cumplimiento lo detecta de verdad.
    const finalPoint =
      state.lateralOffset > 0
        ? destinationPoint(point, state.lateralBearing, state.lateralOffset)
        : point;

    const commune = resolveCommune(finalPoint, [...COMMUNES]);

    const position: Position = {
      vehicleId: state.vehicleId,
      deviceId: asDeviceId(state.deviceId),
      timestamp: at.toISOString(),
      receivedAt: at.toISOString(),
      lat: finalPoint.lat,
      lng: finalPoint.lng,
      speed: Math.round(state.speedKmh * 10) / 10,
      heading: Math.round(heading),
      altitude: 520 + Math.round(state.rng.float(-40, 60)),
      accuracy: Math.round(state.rng.float(3, 12)),
      ignition: state.ignitionOn ? 'on' : 'off',
      odometerKm: Math.round(state.odometerKm * 10) / 10,
      batteryLevel: 100,
      communeCode: commune?.code,
      valid: true,
    };

    state.history.push(position);
    if (state.history.length > MAX_HISTORY_SAMPLES) {
      state.history.splice(0, state.history.length - MAX_HISTORY_SAMPLES);
    }

    this.detectGeofenceCrossings(state, position, at);
  }

  /** Emite entradas y salidas de las geocercas activas del cliente. */
  private detectGeofenceCrossings(state: VehicleSimState, position: Position, at: Date): void {
    const dataset = getDataset();
    const point: LatLng = { lat: position.lat, lng: position.lng };

    for (const geofence of dataset.geofences) {
      if (!geofence.active || geofence.geometry.shape !== 'circle') continue;
      // Solo interesan las geocercas cercanas: evitar recorrer las 80 en cada
      // muestra de cada vehiculo.
      const distance = haversineMeters(geofence.geometry.center, point);
      if (distance > geofence.geometry.radiusMeters + 2_000) continue;

      const inside = distance <= geofence.geometry.radiusMeters;
      const wasInside = state.insideGeofences.has(geofence.id);
      if (inside === wasInside) continue;

      if (inside) state.insideGeofences.add(geofence.id);
      else state.insideGeofences.delete(geofence.id);

      state.events.push({
        id: `evt-${state.vehicleId}-${at.getTime()}-${geofence.id}`,
        vehicleId: state.vehicleId,
        deviceId: asDeviceId(state.deviceId),
        type: inside ? 'geofence_enter' : 'geofence_exit',
        timestamp: at.toISOString(),
        position: point,
        geofenceId: geofence.id,
        detail: geofence.name,
      });
      if (state.events.length > MAX_EVENTS) state.events.shift();
    }
  }

  private pushEvent(state: VehicleSimState, type: GpsEventType, at: Date, detail: string): void {
    const { point } = pointAt(state.path, state.cumulative, state.alongMeters);
    state.events.push({
      id: `evt-${state.vehicleId}-${at.getTime()}-${type}`,
      vehicleId: state.vehicleId,
      deviceId: asDeviceId(state.deviceId),
      type,
      timestamp: at.toISOString(),
      position: point,
      detail,
    });
    if (state.events.length > MAX_EVENTS) state.events.shift();
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  getCurrentPositions(): Position[] {
    this.start();
    const positions: Position[] = [];
    for (const state of this.states.values()) {
      const last = state.history[state.history.length - 1];
      if (last) positions.push(last);
    }
    return positions;
  }

  getPosition(vehicleId: VehicleId): Position | null {
    this.start();
    const state = this.states.get(vehicleId);
    if (!state) return null;
    return state.history[state.history.length - 1] ?? null;
  }

  getHistory(vehicleId: VehicleId, from: Date, to: Date, limit?: number): Position[] {
    this.start();
    const state = this.states.get(vehicleId);
    if (!state) return [];

    const fromMs = from.getTime();
    const toMs = to.getTime();
    const filtered = state.history.filter((p) => {
      const ms = new Date(p.timestamp).getTime();
      return ms >= fromMs && ms <= toMs;
    });

    if (!limit || filtered.length <= limit) return filtered;

    // Submuestreo uniforme conservando la ultima muestra.
    const step = filtered.length / limit;
    const sampled: Position[] = [];
    for (let i = 0; i < limit; i += 1) sampled.push(filtered[Math.floor(i * step)]!);
    const last = filtered[filtered.length - 1]!;
    if (sampled[sampled.length - 1] !== last) sampled.push(last);
    return sampled;
  }

  getEvents(vehicleId?: VehicleId, limit = 100): GpsEvent[] {
    this.start();
    const all: GpsEvent[] = [];
    for (const [id, state] of this.states) {
      if (vehicleId && id !== vehicleId) continue;
      all.push(...state.events);
    }
    return all
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /** Ultimo instante con datos validos, para el mensaje de degradacion. */
  getLastKnownAt(vehicleId: VehicleId): string | null {
    this.start();
    const state = this.states.get(vehicleId);
    return state?.history[state.history.length - 1]?.timestamp ?? null;
  }

  /** Progreso de paradas visitadas, consumido por el estado de las OT. */
  getVisitedStopSequences(vehicleId: VehicleId): number[] {
    this.start();
    const state = this.states.get(vehicleId);
    if (!state) return [];
    return state.stops.filter((s) => s.visitedEver).map((s) => s.sequence);
  }

  getMode(vehicleId: VehicleId): SimMode | null {
    this.start();
    return this.states.get(vehicleId)?.mode ?? null;
  }
}

/**
 * Singleton resistente al hot-reload de Next.js en desarrollo: sin esto cada
 * recompilacion crearia una flota nueva y el historial se perderia.
 */
const globalForSimulator = globalThis as unknown as { __feniceSimulator?: FleetSimulator };

export const fleetSimulator: FleetSimulator =
  globalForSimulator.__feniceSimulator ?? (globalForSimulator.__feniceSimulator = new FleetSimulator());

export const SIMULATOR_TICK_MS = TICK_MS;