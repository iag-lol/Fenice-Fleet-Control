'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, Pause, Play, Power, PowerOff, RefreshCw, Square } from 'lucide-react';
import { FleetMap } from '@/components/map/fleet-map';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { systemModeQuery } from '@/hooks/use-control-data';
import {
  buildReplayTimeline,
  findIgnitionEvents,
  findSpeedingEvents,
  findStops,
  frameAt,
} from '@/lib/engines/route-replay';
import { formatDistance, formatTimeWithSeconds } from '@/lib/format';
import type { Position, Vehicle } from '@/types/core';
import type { RouteGeometry } from '@/types/views';

const DEFAULT_MAX_LEGAL_SPEED_KMH = 60;

interface HistoryEvent {
  at: string;
  label: string;
  icon: typeof Square;
  tone: 'warning' | 'active' | 'dormant';
}

function localTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function VehicleHistory({ vehicle }: { vehicle: Vehicle }) {
  const { data: mode } = useQuery(systemModeQuery);
  const maxLegalSpeedKmh = mode?.settings.route.maxLegalSpeedKmh ?? DEFAULT_MAX_LEGAL_SPEED_KMH;
  const [from, setFrom] = useState(() => { const day = new Date(); day.setHours(0, 0, 0, 0); return localTime(day); });
  const [to, setTo] = useState(() => localTime(new Date()));
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['vehicle-history', vehicle.id, range], enabled: range !== null, staleTime: 60_000,
    queryFn: async ({ signal }): Promise<Position[]> => {
      const params = new URLSearchParams({ desde: range!.from, hasta: range!.to, limite: '20000' });
      const response = await fetch(`/api/gps/history/${encodeURIComponent(vehicle.id)}?${params}`, { signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'No se pudo consultar el historial GPS.');
      }
      return response.json();
    },
  });
  const timeline = useMemo(() => data ? buildReplayTimeline(data) : null, [data]);
  const stops = useMemo(() => timeline ? findStops(timeline) : [], [timeline]);
  // Detenciones y cambios de ignicion en una sola linea de eventos: son las
  // dos cosas que la operacion quiere poder saltar a revisar directamente.
  const events = useMemo((): HistoryEvent[] => {
    if (!timeline) return [];
    const stopEvents: HistoryEvent[] = stops.map((stop) => ({
      at: stop.startedAt,
      label: `Detención · ${Math.round(stop.durationSeconds / 60)} min`,
      icon: Square,
      tone: 'warning',
    }));
    const ignitionEvents: HistoryEvent[] = findIgnitionEvents(timeline).map((event) => ({
      at: event.at,
      label: event.type === 'ignition_on' ? 'Encendido' : 'Apagado',
      icon: event.type === 'ignition_on' ? Power : PowerOff,
      tone: event.type === 'ignition_on' ? 'active' : 'dormant',
    }));
    const speedingEvents: HistoryEvent[] = findSpeedingEvents(timeline, maxLegalSpeedKmh).map((event) => ({
      at: event.startedAt,
      label: `Exceso de velocidad · ${event.maxSpeedKmh} km/h`,
      icon: AlertTriangle,
      tone: 'dormant',
    }));
    return [...stopEvents, ...ignitionEvents, ...speedingEvents].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at),
    );
  }, [timeline, stops, maxLegalSpeedKmh]);
  const frame = timeline ? frameAt(timeline, cursor ?? timeline.startMs) : null;
  useEffect(() => { setCursor(null); setPlaying(false); }, [data]);
  useEffect(() => {
    if (!playing || !timeline) return;
    // 1 segundo real reproduce un minuto. No actualiza el mapa 60 veces/s.
    const started = performance.now();
    const offset = cursor ?? timeline.startMs;
    const timer = setInterval(() => {
      const next = Math.min(timeline.endMs, offset + (performance.now() - started) * 60);
      setCursor(next);
      if (next === timeline.endMs) setPlaying(false);
    }, 200);
    return () => clearInterval(timer);
    // El cursor cambia durante la reproduccion; el reloj conserva su origen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline]);
  const routes: RouteGeometry[] = frame ? [{
    routeId: `history-${vehicle.id}`, code: 'GPS', name: 'Recorrido registrado', vehicleId: vehicle.id,
    vehiclePlate: vehicle.plate, status: 'completada', plannedPath: [], executedPath: frame.traveledPath,
    executedSegments: frame.traveledSegments, stops: [],
  }] : [];
  const download = () => {
    if (!data) return;
    const rows = ['fecha_utc,latitud,longitud,velocidad_kmh,rumbo', ...data.map((p) =>
      [new Date(p.timestamp).toISOString(), p.lat, p.lng, p.speed, p.heading].join(','))];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `recorrido-${vehicle.plate.replace(/[^a-zA-Z0-9-]/g, '')}.csv`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const load = () => {
    const start = Date.parse(from), end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 72 * 3_600_000) {
      setValidation('Elige un rango valido de hasta 72 horas.'); return;
    }
    setValidation(null); setPlaying(false);
    const next = { from: new Date(start).toISOString(), to: new Date(end).toISOString() };
    if (range?.from === next.from && range?.to === next.to) void refetch();
    else setRange(next);
  };
  return <Card>
    <CardHeader title="Recorridos guardados" description="Consulta por fecha, reproduce la jornada y descarga las muestras originales." />
    <CardBody className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-muted">Desde
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block rounded border border-line bg-surface-900 p-2 text-ink" />
        </label>
        <label className="text-xs text-ink-muted">Hasta
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block rounded border border-line bg-surface-900 p-2 text-ink" />
        </label>
        <Button onClick={load} loading={isFetching} icon={<RefreshCw className="h-4 w-4" />}>Consultar recorrido</Button>
        <Button onClick={download} disabled={!data?.length} variant="ghost" icon={<Download className="h-4 w-4" />}>Descargar muestras</Button>
      </div>
      <p className="text-xs text-ink-faint">Horarios según la zona horaria de este equipo. Los intervalos sin señal no se completan con posiciones inventadas.</p>
      {validation || error ? <p role="alert" className="text-sm text-status-warning">{validation ?? (error as Error).message}</p> : null}
      {data && !timeline ? <p className="text-sm text-ink-muted">{data.length ? 'Solo hay una muestra en este periodo; se puede descargar, pero no alcanza para reproducir un recorrido.' : 'No hay posiciones guardadas para este periodo. Revisa la transmisión y el almacenamiento del proveedor GPS.'}</p> : null}
      {timeline && frame ? <>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Button onClick={() => { if (!playing && cursor === timeline.endMs) setCursor(timeline.startMs); setPlaying(!playing); }} icon={playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}>{playing ? 'Pausar' : 'Reproducir'}</Button>
          <span>{formatTimeWithSeconds(frame.timestamp)} · {data?.length} muestras · {stops.length} detenciones</span>
          <span>{formatDistance(timeline.totalMeters)} entre muestras continuas</span>
          <span className={frame.ignition === 'on' ? 'text-status-active' : frame.ignition === 'off' ? 'text-ink-faint' : 'text-ink-faint'}>
            {frame.ignition === 'on' ? 'Motor encendido' : frame.ignition === 'off' ? 'Motor apagado' : 'Ignición sin dato'}
          </span>
          {frame.signalGap ? <span className="text-status-warning">Sin muestras en este intervalo</span> : null}
        </div>
        <input aria-label="Instante del recorrido guardado" type="range" min={timeline.startMs} max={timeline.endMs} step={1000} value={cursor ?? timeline.startMs}
          onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} className="w-full" />
        <div className="relative h-[400px] overflow-hidden rounded-lg">
          <FleetMap key={`${vehicle.id}-${range?.from}-${range?.to}`} autoFit className="absolute inset-0" vehicles={[{
            vehicleId: vehicle.id, plate: vehicle.plate, fleetCode: vehicle.fleetCode, status: frame.stopped ? 'stopped' : 'moving',
            position: { ...timeline.samples[frame.sampleIndex]!, ...frame.position, heading: frame.heading },
          }]} routes={routes} clients={[]} geofences={[]} alerts={[]} workOrders={[]} communes={[]} heatmapPoints={[]}
            layerOverride={{ camiones: true, rutas: true, clientes: false, geocercas: false, calor: false, pedidos: false, alertas: false, comunas: false }} />
        </div>
        {events.length ? <div className="space-y-1.5">
          <p className="text-xs font-medium text-ink-muted">Eventos de la jornada</p>
          <div className="flex flex-wrap gap-2">
            {events.map((event) => {
              const Icon = event.icon;
              return (
                <Button
                  key={`${event.label}-${event.at}`}
                  size="sm"
                  variant="ghost"
                  icon={<Icon className="h-3.5 w-3.5" />}
                  onClick={() => { setPlaying(false); setCursor(Date.parse(event.at)); }}
                  className={
                    event.tone === 'active'
                      ? 'text-status-active'
                      : event.tone === 'dormant'
                        ? 'text-ink-faint'
                        : 'text-status-warning'
                  }
                >
                  {event.label} · {formatTimeWithSeconds(event.at)}
                </Button>
              );
            })}
          </div>
        </div> : null}
      </> : null}
    </CardBody>
  </Card>;
}
