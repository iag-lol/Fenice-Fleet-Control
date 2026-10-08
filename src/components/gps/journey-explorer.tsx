'use client';

import { buildEvidenceTimeline, hasJourneyEvidence } from '@/lib/engines/gps-evidence';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Flag,
  Gauge,
  LocateFixed,
  Layers2,
  Satellite,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Power,
  Radio,
  RotateCcw,
  Route,
  Square,
  Timer,
  Truck,
} from 'lucide-react';
import { JourneySpeedChart } from '@/components/gps/journey-speed-chart';
import { FleetMap } from '@/components/map/fleet-map';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import {
  findIgnitionEvents,
  findSpeedingEvents,
  findStops,
  frameAt,
} from '@/lib/engines/route-replay';
import {
  analyzeJourney,
  exportJourneyGeoJson,
  sectionsThroughSample,
} from '@/lib/engines/journey-analysis';
import {
  formatDistance,
  formatDuration,
  formatTimeWithSeconds,
} from '@/lib/format';
import { resolveFeature } from '@/product/feature-access';
import type { MapViewMode } from '@/components/map/map-style';
import { cn } from '@/lib/cn';
import type { LatLng, Position, Vehicle } from '@/types/core';
import type { RouteGeometry } from '@/types/views';

type EventKind =
  | 'stop'
  | 'speeding'
  | 'ignition_on'
  | 'ignition_off'
  | 'signal_gap';
interface JourneyEvent {
  id: string;
  kind: EventKind;
  at: string;
  end?: string;
  title: string;
  detail: string;
  position: LatLng;
}
const EVENT_ICONS = {
  stop: Square,
  speeding: Gauge,
  ignition_on: Power,
  ignition_off: Power,
  signal_gap: Radio,
};
const SPEEDS = [1, 15, 60, 180, 600];

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** El mismo explorador se usa para la ficha GPS y para la jornada de una ruta. */
export function JourneyExplorer({
  positions,
  vehicle,
  plannedRoute,
  speedLimit = 60,
}: {
  positions: Position[];
  vehicle: Pick<Vehicle, 'id' | 'plate' | 'fleetCode'>;
  plannedRoute?: RouteGeometry;
  speedLimit?: number;
}) {
  const timeline = useMemo(() => buildEvidenceTimeline(positions), [positions]);
  const summary = useMemo(
    () => (timeline ? analyzeJourney(timeline, speedLimit) : null),
    [timeline, speedLimit],
  );
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60);
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(false);
  const [colored, setColored] = useState(true);
  const [mapMode, setMapMode] = useState<MapViewMode>('standard');
  const satelliteAccess = resolveFeature('satellite-view');
  const [eventLimit, setEventLimit] = useState(100);
  const [eventFilter, setEventFilter] = useState<EventKind | 'all'>('all');
  const [activeEvent, setActiveEvent] = useState<string | null>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const clock = useRef(0);
  const cursorRef = useRef<number | null>(null);
  const at = timeline
    ? Math.max(
        timeline.startMs,
        Math.min(cursor ?? timeline.endMs, timeline.endMs),
      )
    : 0;
  const frame = useMemo(
    () => (timeline ? frameAt(timeline, at) : null),
    [timeline, at],
  );
  const frameIndex = frame?.sampleIndex ?? 0;
  const activeSections = useMemo(
    () =>
      timeline && summary
        ? sectionsThroughSample(timeline, summary, frameIndex)
        : [],
    [timeline, summary, frameIndex],
  );
  const observedFrame = useMemo(
    () =>
      timeline
        ? frameAt(timeline, Date.parse(timeline.samples[frameIndex]!.timestamp))
        : null,
    [timeline, frameIndex],
  );
  const complete = useMemo(
    () => (timeline ? frameAt(timeline, timeline.endMs) : null),
    [timeline],
  );
  const events = useMemo((): JourneyEvent[] => {
    if (!timeline || !summary) return [];
    return [
      ...findStops(timeline).map((stop) => ({
        id: `stop-${stop.startedAt}`,
        kind: 'stop' as const,
        at: stop.startedAt,
        end: stop.endedAt,
        title: 'Detención',
        detail: formatDuration(stop.durationSeconds),
        position: stop.position,
      })),
      ...findIgnitionEvents(timeline).map((event) => ({
        id: `${event.type}-${event.at}`,
        kind: event.type,
        at: event.at,
        title:
          event.type === 'ignition_on'
            ? 'Contacto activado'
            : 'Contacto desactivado',
        detail: 'Cambio registrado',
        position: event.position,
      })),
      ...findSpeedingEvents(timeline, speedLimit).map((event) => ({
        id: `speed-${event.startedAt}`,
        kind: 'speeding' as const,
        at: event.startedAt,
        end: event.endedAt,
        title: 'Velocidad sobre umbral',
        detail: `${event.maxSpeedKmh} km/h · ${formatDuration(event.durationSeconds)}`,
        position: event.position,
      })),
      ...summary.gaps.map((gap) => ({
        id: `gap-${gap.from}`,
        kind: 'signal_gap' as const,
        at: gap.from,
        end: gap.to,
        title: 'Intervalo sin evidencia suficiente',
        detail: formatDuration(gap.seconds),
        position: gap.position,
      })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [timeline, summary, speedLimit]);
  const mapEvents = useMemo(
    () =>
      events.filter((event) => event.kind !== 'signal_gap').map((event) => ({
        id: event.id,
        eventType: event.kind,
        at: event.at,
        endedAt: event.end,
        title: event.title,
        detail: event.detail,
        vehiclePlate: vehicle.plate,
        lat: event.position.lat,
        lng: event.position.lng,
      })),
    [events, vehicle.plate],
  );
  const shownEvents = events.filter(
    (event) => eventFilter === 'all' || event.kind === eventFilter,
  );
  useEffect(() => {
    cursorRef.current = at;
  }, [at]);
  useEffect(() => setEventLimit(100), [eventFilter, vehicle.id]);
  useEffect(() => {
    setPlaying(false);
    setCursor(null);
    setActiveEvent(null);
  }, [vehicle.id, timeline?.startMs, timeline?.endMs]);
  useEffect(() => {
    if (!playing || !timeline) return;
    clock.current = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const elapsed = now - clock.current;
      clock.current = now;
      const next = Math.min(
        timeline.endMs,
        (cursorRef.current ?? timeline.startMs) + elapsed * speed,
      );
      cursorRef.current = next;
      setCursor(next);
      if (next >= timeline.endMs) setPlaying(false);
    }, 120);
    return () => clearInterval(timer);
  }, [playing, speed, timeline]);
  useEffect(() => {
    if (!expanded) return;
    const priorFocus = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    root.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
      if (event.key === 'Tab') {
        const elements = root.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input, select, a[href]',
        );
        const first = elements?.[0],
          last = elements?.[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', keys);
      priorFocus?.focus();
    };
  }, [expanded]);
  useEffect(() => {
    if (!map) return;
    const manual = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) setFollowing(false);
    };
    map.on('dragstart', manual);
    map.on('zoomstart', manual);
    return () => {
      map.off('dragstart', manual);
      map.off('zoomstart', manual);
    };
  }, [map]);
  useEffect(() => {
    if (following && map && frame)
      map.easeTo({
        center: [frame.position.lng, frame.position.lat],
        duration: 100,
        essential: true,
      });
  }, [following, map, frame]);
  const onMapReady = useCallback((ready: MapLibreMap) => setMap(ready), []);
  const fit = useCallback(() => {
    if (!map || !timeline) return;
    const points = [...timeline.samples, ...(plannedRoute?.plannedPath ?? [])];
    map.fitBounds(
      [
        [
          Math.min(...points.map((p) => p.lng)),
          Math.min(...points.map((p) => p.lat)),
        ],
        [
          Math.max(...points.map((p) => p.lng)),
          Math.max(...points.map((p) => p.lat)),
        ],
      ],
      { padding: 64, maxZoom: 16, duration: 600 },
    );
    setFollowing(false);
  }, [map, timeline, plannedRoute]);
  const seek = (time: number) => {
    setPlaying(false);
    setCursor(time);
    cursorRef.current = time;
  };
  const selectEvent = (event: JourneyEvent) => {
    seek(Date.parse(event.at));
    setActiveEvent(event.id);
    if (event.kind === 'signal_gap') return;
    setFollowing(false);
    map?.easeTo({
      center: [event.position.lng, event.position.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 500,
    });
  };
  const routeId = `journey-${vehicle.id}`;
  const routes = useMemo(
    (): RouteGeometry[] =>
      !timeline || !summary || !complete || !observedFrame
        ? []
        : [
            ...(plannedRoute
              ? [{ ...plannedRoute, executedPath: [], executedSegments: [] }]
              : []),
            {
              routeId: `${routeId}-context`,
              code: 'GPS',
              reportedTrace: Boolean(timeline.evidence),
              name: 'Traza GPS consistente',
              vehicleId: vehicle.id,
              vehiclePlate: vehicle.plate,
              status: 'completada',
              plannedPath: [],
              executedPath: complete.traveledPath,
              executedSegments: complete.traveledSegments,
              visualRole: 'context',
              showEndpoints: !timeline.evidence,
              stops: [],
            },
            {
              routeId: `${routeId}-preview`,
              code: 'GPS',
              reportedTrace: Boolean(timeline.evidence),
              name: 'Perfil completo',
              visualRole: 'preview',
              vehicleId: vehicle.id,
              vehiclePlate: vehicle.plate,
              status: 'completada',
              plannedPath: [],
              executedPath: complete.traveledPath,
              executedSegments: complete.traveledSegments,
              speedSections: colored ? summary.speedSections : undefined,
              stops: [],
            },
            {
              routeId,
              code: 'GPS',
              reportedTrace: Boolean(timeline.evidence),
              name: 'Recorrido registrado',
              vehicleId: vehicle.id,
              vehiclePlate: vehicle.plate,
              status: 'completada',
              plannedPath: [],
              executedPath: observedFrame.traveledPath,
              executedSegments: observedFrame.traveledSegments,
              speedSections: colored ? activeSections : undefined,
              stops: [],
            },
          ],
    [
      timeline,
      summary,
      complete,
      observedFrame,
      vehicle.id,
      vehicle.plate,
      routeId,
      plannedRoute,
      colored,
      activeSections,
    ],
  );
  if (!timeline || !summary || !frame || !complete)
    return (
      <div className="rounded-lg border border-line bg-surface-900 p-8 text-center">
        <Route className="mx-auto mb-3 h-7 w-7 text-ink-faint" />
        <p className="font-medium text-ink">
          Todavía no hay un recorrido para explorar
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Se necesitan al menos dos posiciones GPS válidas dentro del periodo
          consultado.
        </p>
        {positions.length ? (
          <Button
            className="mt-4"
            size="sm"
            variant="secondary"
            icon={<ArrowDownToLine className="h-4 w-4" />}
            onClick={() =>
              download(
                [
                  'fecha_utc,latitud,longitud,velocidad_reportada_kmh,rumbo_reportado,ignicion_reportada,evidencia_intervalo_anterior',
                  ...positions.map((p) =>
                    [
                      p.timestamp,
                      p.lat,
                      p.lng,
                      p.speedKnown === false ? '' : p.speed,
                      p.heading,
                      p.ignition,
                      'sin_evaluar',
                    ].join(','),
                  ),
                ].join('\n'),
                `muestras-${vehicle.plate.replace(/[^A-Z0-9-]/gi, '')}.csv`,
                'text/csv;charset=utf-8',
              )
            }
          >
            Descargar muestras disponibles
          </Button>
        ) : null}
      </div>
    );
  const filename = `recorrido-${vehicle.plate.replace(/[^A-Z0-9-]/gi, '')}-${new Date(timeline.startMs).toISOString().slice(0, 10)}`;
  return (
    <div
      ref={root}
      tabIndex={-1}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded || undefined}
      aria-label="Explorador de recorrido GPS"
      className={cn(
        'overflow-hidden rounded-xl border border-line bg-surface-900 shadow-card outline-none',
        expanded &&
          'fixed inset-2 z-[80] overflow-auto shadow-panel sm:inset-4',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#102b46] px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 bg-white/10">
            <Route className="h-5 w-5 text-cyan-200" />
          </span>
          <div>
            <p className="text-[10px] uppercase tracking-[.18em] text-slate-300">
              Explorador GPS
            </p>
            <h3 className="text-base font-semibold">
              {vehicle.plate}{' '}
              <span className="ml-1 text-xs font-normal text-slate-300">
                · {vehicle.fleetCode}
              </span>
            </h3>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() =>
              download(
                JSON.stringify(
                  exportJourneyGeoJson(timeline, vehicle.plate),
                  null,
                  2,
                ),
                `${filename}.geojson`,
                'application/geo+json',
              )
            }
            className="flex h-9 items-center gap-1.5 rounded-md border border-white/20 px-3 text-xs hover:bg-white/10"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            GeoJSON
          </button>
          <button
            onClick={() =>
              download(
                [
                  'fecha_utc,latitud,longitud,velocidad_reportada_kmh,rumbo_reportado,ignicion_reportada,evidencia_intervalo_anterior',
                  ...timeline.samples.map((p, index) =>
                    [
                      p.timestamp,
                      p.lat,
                      p.lng,
                      p.speedKnown === false ? '' : p.speed,
                      p.heading,
                      p.ignition,
                      index ? (timeline.evidence?.[index - 1] ?? 'simulated') : 'primera_lectura',
                    ].join(','),
                  ),
                ].join('\n'),
                `${filename}.csv`,
                'text/csv;charset=utf-8',
              )
            }
            className="flex h-9 items-center gap-1.5 rounded-md border border-white/20 px-3 text-xs hover:bg-white/10"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-label={
              expanded ? 'Cerrar vista ampliada' : 'Ampliar explorador'
            }
            className="flex h-9 w-9 items-center justify-center rounded-md border border-white/20 hover:bg-white/10"
          >
            {expanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line bg-surface-850 sm:grid-cols-6">
        {(
          [
            [
              'Distancia GPS estimada',
              hasJourneyEvidence(timeline) ? formatDistance(timeline.totalMeters) : 'Sin evidencia',
              Route,
            ],
            ['Marcha consistente', hasJourneyEvidence(timeline) ? formatDuration(summary.movingSeconds) : 'Sin evidencia', Truck],
            ['Reposo consistente', hasJourneyEvidence(timeline) ? formatDuration(summary.stoppedSeconds) : 'Sin evidencia', Timer],
            [
              'Detenido con contacto',
              formatDuration(summary.idleSeconds),
              Power,
            ],
            ['Máxima reportada', timeline.samples.some((p) => p.speedKnown !== false) ? `${Math.round(summary.maxSpeed)} km/h` : '—', Gauge],
            [
              'Consistencia GPS',
              `${Math.round(summary.coverage * 100)} %`,
              Radio,
            ],
          ] as const
        ).map(([label, value, Icon]) => (
          <div key={label} className="min-w-0 px-3 py-3">
            <p className="flex items-center gap-1 text-[10px] text-ink-faint">
              <Icon className="hidden h-3 w-3 sm:block" />
              {label}
            </p>
            <p className="numeric mt-1 truncate text-sm font-semibold text-ink">
              {value}
            </p>
          </div>
        ))}
      </div>
      <div className="grid xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="relative h-[360px] sm:h-[440px] xl:h-[500px]">
          <ErrorBoundary section="el explorador GPS">
            <FleetMap
              key={vehicle.id}
              autoFit
              isolated
              playbackMode
              highlightedRoute={routeId}
              onMapReady={onMapReady}
              viewModeOverride={mapMode}
              className="absolute inset-0"
              vehicles={[
                {
                  vehicleId: vehicle.id,
                  plate: vehicle.plate,
                  fleetCode: vehicle.fleetCode,
                  status: frame.signalGap || (timeline.evidence && timeline.evidence[Math.max(0, frame.sampleIndex - 1)] === 'uncertain')
                    ? 'uncertain'
                    : frame.stopped
                      ? 'stopped'
                      : 'moving',
                  position: {
                    ...timeline.samples[frame.sampleIndex]!,
                    ...frame.position,
                    speed: frame.speed,
                    heading: frame.heading,
                    roadMatch: undefined,
                  },
                },
              ]}
              routes={routes}
              clients={[]}
              geofences={[]}
              alerts={[]}
              workOrders={[]}
              communes={[]}
              heatmapPoints={[]}
              trajectoryEvents={mapEvents}
              onSelectTrajectoryEvent={(id) => {
                const event = events.find((item) => item.id === id);
                if (event) selectEvent(event);
              }}
              layerOverride={{
                camiones: true,
                rutas: true,
                clientes: false,
                geocercas: false,
                calor: false,
                pedidos: false,
                alertas: false,
                comunas: false,
              }}
            />
          </ErrorBoundary>
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              aria-label="Ver recorrido completo"
              onClick={fit}
              icon={<Maximize2 className="h-3.5 w-3.5" />}
            >
              <span className="hidden sm:inline">Ver recorrido</span>
            </Button>
            <Button
              size="sm"
              variant={following ? 'primary' : 'secondary'}
              aria-label={
                following ? 'Dejar de seguir vehículo' : 'Seguir vehículo'
              }
              onClick={() => {
                setFollowing(!following);
                if (!following)
                  map?.easeTo({
                    center: [frame.position.lng, frame.position.lat],
                    zoom: 15,
                    duration: 400,
                  });
              }}
              icon={<LocateFixed className="h-3.5 w-3.5" />}
            >
              <span className="hidden sm:inline">
                {following ? 'Siguiendo' : 'Seguir vehículo'}
              </span>
            </Button>
          </div>
          <div
            className="absolute right-3 top-3 flex rounded-lg border border-line bg-surface-900 p-0.5 shadow-card"
            role="group"
            aria-label="Base del mapa de recorrido"
          >
            <button
              aria-pressed={mapMode === 'standard'}
              aria-label="Mapa de calles"
              onClick={() => {
                setMapMode('standard');
                setFollowing(false);
                setMap(null);
              }}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2 text-xs',
                mapMode === 'standard'
                  ? 'bg-brand-500/10 text-brand-700'
                  : 'text-ink-faint',
              )}
            >
              <Layers2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Mapa</span>
            </button>
            <button
              aria-pressed={mapMode === 'hybrid'}
              aria-label="Vista satelital del recorrido"
              disabled={!satelliteAccess.includedInPlan}
              title={
                satelliteAccess.includedInPlan
                  ? 'Imagen satelital con referencias'
                  : (satelliteAccess.reason ?? undefined)
              }
              onClick={() => {
                setMapMode('hybrid');
                setFollowing(false);
                setMap(null);
              }}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2 text-xs disabled:opacity-40',
                mapMode === 'hybrid'
                  ? 'bg-brand-500/10 text-brand-700'
                  : 'text-ink-faint',
              )}
            >
              <Satellite className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Satélite</span>
            </button>
          </div>
          <div className="pointer-events-none absolute bottom-10 left-3 rounded-lg border border-line bg-surface-900/95 px-3 py-2 shadow-card backdrop-blur">
            <p className="numeric text-xl font-semibold text-ink">
              {frame.signalGap ? '—' : Math.round(frame.speed)}{' '}
              <span className="text-xs font-normal text-ink-faint">km/h</span>
            </p>
            <p className="text-[10px] text-ink-muted">
              {frame.ignition === 'on'
                ? 'Contacto encendido'
                : frame.ignition === 'off'
                  ? 'Contacto apagado'
                  : 'Ignición sin dato'}{' '}
              ·{' '}
              {formatTimeWithSeconds(
                timeline.samples[frame.sampleIndex]!.timestamp,
              )}
            </p>
          </div>
          {frame.signalGap ? (
            <div
              role="status"
              className="absolute bottom-10 right-3 max-w-[230px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
            >
              <AlertTriangle className="mb-1 h-4 w-4" />
              Intervalo sin continuidad. Se conserva la última ubicación
              observada.
            </div>
          ) : null}
        </div>
        <aside className="flex max-h-[260px] flex-col border-t border-line bg-surface-850 xl:max-h-[500px] xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between px-3 py-3">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-ink">
              <Activity className="h-4 w-4 text-brand-700" />
              Eventos del recorrido
            </h4>
            <span className="rounded bg-surface-750 px-1.5 text-xs text-ink-muted">
              {events.length}
            </span>
          </div>
          <select
            aria-label="Filtrar eventos del recorrido"
            value={eventFilter}
            onChange={(e) =>
              setEventFilter(e.target.value as EventKind | 'all')
            }
            className="mx-3 mb-3 rounded border border-line bg-surface-900 p-2 text-xs text-ink"
          >
            <option value="all">Todos los eventos</option>
            <option value="stop">Detenciones desde 3 min</option>
            <option value="speeding">Velocidad sobre umbral</option>
            <option value="signal_gap">Intervalos inciertos</option>
            <option value="ignition_on">Encendidos</option>
            <option value="ignition_off">Apagados</option>
          </select>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {shownEvents.length ? (
              shownEvents.slice(0, eventLimit).map((event) => {
                const Icon = EVENT_ICONS[event.kind];
                return (
                  <button
                    key={event.id}
                    onClick={() => selectEvent(event)}
                    aria-pressed={activeEvent === event.id}
                    className={cn(
                      'mb-1 flex w-full items-start gap-2 rounded-lg border border-transparent p-2.5 text-left hover:bg-surface-750',
                      activeEvent === event.id &&
                        'border-brand-500/30 bg-brand-500/10',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 rounded-md bg-surface-750 p-1.5 text-ink-muted',
                        event.kind === 'speeding' && 'bg-red-50 text-red-600',
                        event.kind === 'signal_gap' &&
                          'bg-amber-50 text-amber-600',
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block text-xs font-medium text-ink">
                        {event.title}
                      </span>
                      <span className="numeric mt-1 block text-[10px] text-ink-faint">
                        {formatTimeWithSeconds(event.at)} · {event.detail}
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-6 text-xs text-ink-faint">
                No hay eventos de este tipo en el periodo.
              </p>
            )}
            {shownEvents.length > eventLimit ? (
              <button
                className="w-full rounded-lg p-3 text-xs font-medium text-brand-700"
                onClick={() => setEventLimit((limit) => limit + 100)}
              >
                Mostrar más eventos ({shownEvents.length - eventLimit})
              </button>
            ) : null}
          </div>
        </aside>
      </div>
      <div className="border-t border-line px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-faint">
          <p className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" />
            Perfil de velocidad · umbral {speedLimit} km/h
          </p>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={colored}
              onChange={(e) => setColored(e.target.checked)}
            />
            Color por velocidad
          </label>
        </div>
        <JourneySpeedChart
          timeline={timeline}
          gaps={summary.gaps}
          maximum={summary.maxSpeed}
          limit={speedLimit}
          at={at}
          onSeek={(time) => {
            setActiveEvent(null);
            seek(time);
          }}
        />
        <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
          <span>
            {formatTimeWithSeconds(new Date(timeline.startMs).toISOString())}
          </span>
          <span>
            {timeline.samples.length.toLocaleString('es-CL')} muestras
          </span>
          <span>
            {formatTimeWithSeconds(new Date(timeline.endMs).toISOString())}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            icon={
              playing ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )
            }
            onClick={() => {
              if (!playing && at >= timeline.endMs) {
                setCursor(timeline.startMs);
                cursorRef.current = timeline.startMs;
              }
              setPlaying(!playing);
              setActiveEvent(null);
            }}
          >
            {playing ? 'Pausar' : 'Reproducir'}
          </Button>
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label="Evento anterior"
            disabled={!events.length}
            onClick={() => {
              const event = [...events]
                .reverse()
                .find((e) => Date.parse(e.at) < at - 1000);
              if (event) selectEvent(event);
              else seek(timeline.startMs);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label="Evento siguiente"
            disabled={!events.length}
            onClick={() => {
              const event = events.find((e) => Date.parse(e.at) > at + 1000);
              if (event) selectEvent(event);
              else seek(timeline.endMs);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Volver al inicio del recorrido"
            onClick={() => seek(timeline.startMs)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Ir al final del recorrido"
            onClick={() => seek(timeline.endMs)}
          >
            <Flag className="h-3.5 w-3.5" />
          </Button>
          <span className="numeric rounded bg-surface-850 px-2 py-1 text-xs font-semibold text-ink">
            {formatTimeWithSeconds(frame.timestamp)}
          </span>
          <label className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
            Reproducción
            <select
              aria-label="Velocidad de reproducción"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="rounded border border-line bg-surface-900 p-1.5 text-ink"
            >
              {SPEEDS.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2 text-[10px] text-ink-faint">
          {[
            ['#0891b2', 'Menos de 30 km/h'],
            ['#2563eb', `30–${speedLimit} km/h`],
            ['#dc2626', 'Sobre el umbral'],
            ['#94a3b8', 'Traza GPS consistente'],
          ].map(([color, label]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="h-1 w-4 rounded" style={{ background: color }} />
              {label}
            </span>
          ))}
          {plannedRoute ? (
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-[#173f67]" />
              Ruta planificada
            </span>
          ) : null}
          <span>
            Los intervalos inciertos no suman distancia ni tiempo
            observado.
          </span>
          <span>
            {timeline.roadMatchedMeters > 0
              ? `${formatDistance(timeline.roadMatchedMeters)} con ajuste vial validado. `
              : ''}
            {timeline.totalMeters - timeline.roadMatchedMeters > 1
              ? 'Los tramos entre puntos GPS son aproximados; pueden omitir giros entre reportes.'
              : 'Sin tramos de movimiento respaldados por muestras consistentes.'}
          </span>
        </div>
      </div>
    </div>
  );
}
