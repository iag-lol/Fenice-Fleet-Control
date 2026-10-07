'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  Clock,
  Crosshair,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Search,
  Layers,
  Maximize2,
  Minimize2,
  Plus,
  Minus,
  Radio,
  ShieldCheck,
  Truck,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { BrandMark } from '@/components/shell/brand';
import { FleetMap } from '@/components/map/fleet-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import {
  DEFAULT_TRACKING_CONTENT,
  type TrackingContent,
} from '@/config/tracking-content';
import { TrackingCampaignCarousel } from './tracking-campaign-carousel';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppHeight } from '@/hooks/use-app-height';
import { formatElapsed, formatEta, formatTime } from '@/lib/format';
import { isUsableCoordinate } from '@/lib/geo';
import { cn } from '@/lib/cn';
import type { TrackingSession } from '@/types/core';

const TRACKING_ROUTE = 'tracking-trajectory';
export function TrackingView({
  presetReference,
}: { presetReference?: string } = {}) {
  useAppHeight();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRef = presetReference ?? searchParams.get('ref') ?? '';
  const [reference, setReference] = useState(initialRef);
  const [submitted, setSubmitted] = useState(initialRef);
  const [searchOpen, setSearchOpen] = useState(!initialRef);
  const [satellite, setSatellite] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { data: campaignContent } = useQuery({
    queryKey: ['tracking-content'],
    staleTime: 30000,
    refetchInterval: 60000,
    queryFn: async (): Promise<TrackingContent> => {
      const response = await fetch('/api/seguimiento/contenido');
      if (!response.ok) throw new Error('Publicidad no disponible');
      return response.json();
    },
  });
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [following, setFollowing] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    setReference(initialRef);
    setSubmitted(initialRef);
  }, [initialRef]);
  useEffect(() => {
    const update = () => setTick(Date.now());
    const timer = setInterval(update, 10000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
    };
  }, []);
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['tracking', submitted],
    enabled: submitted.trim().length >= 4,
    refetchInterval: 20000,
    retry: false,
    queryFn: async ({ signal }): Promise<TrackingSession> => {
      const response = await fetch(
        `/api/seguimiento?ref=${encodeURIComponent(submitted)}`,
        { signal },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ?? 'No encontramos un pedido con ese número.',
        );
      }
      return response.json();
    },
  });
  const onMapReady = useCallback((ready: MapLibreMap) => setMap(ready), []);
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
  const age = data?.vehicle?.lastUpdateAt
    ? Math.max(
        0,
        Math.round((tick - Date.parse(data.vehicle.lastUpdateAt)) / 1000),
      )
    : null;
  const expiresAt = data?.vehicle?.positionExpiresAt
    ? Date.parse(data.vehicle.positionExpiresAt)
    : null;
  const expired =
    expiresAt !== null && Number.isFinite(expiresAt)
      ? tick >= expiresAt
      : age !== null && age >= 180;
  const vehiclePosition = expired ? null : data?.vehicle?.position;
  const freshUntil = data?.vehicle?.freshUntil
    ? Date.parse(data.vehicle.freshUntil)
    : null;
  const late =
    freshUntil !== null && Number.isFinite(freshUntil)
      ? tick >= freshUntil
      : age !== null && age >= 60;
  useEffect(() => {
    if (following && map && vehiclePosition)
      map.easeTo({
        center: [vehiclePosition.lng, vehiclePosition.lat],
        duration: 800,
      });
  }, [map, following, vehiclePosition]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = reference.trim();
    if (value.length < 4) return;
    setSubmitted(value);
    setFollowing(false);
    setSearchOpen(false);
    router.replace(`/seguimiento/${encodeURIComponent(value)}`);
  };
  const cancelled = data?.status === 'cancelada';
  const delivered = !!data && !data.trackingAllowed && !cancelled;
  const atDestination = data?.status === 'en_cliente';
  const inRoute =
    !!data && ['en_ruta', 'proxima', 'en_cliente'].includes(data.status);
  const delayed =
    !vehiclePosition ||
    data?.vehicle?.connection === 'stale' ||
    late ||
    isError;
  const currentEta = delayed ? null : data?.eta;
  const fit = useCallback(() => {
    if (!map || !data) return;
    const points = [
      ...(data.trajectory ?? []),
      ...(vehiclePosition ? [vehiclePosition] : []),
      ...(data.destination.coordinates ? [data.destination.coordinates] : []),
    ].filter(isUsableCoordinate);
    if (!points.length) return;
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
      {
        padding: Math.min(
          70,
          map.getContainer().clientWidth / 5,
          map.getContainer().clientHeight / 5,
        ),
        maxZoom: 15,
        duration: 600,
      },
    );
    setFollowing(false);
  }, [map, data, vehiclePosition]);
  useEffect(() => {
    if (!map) return;
    const resized = () => {
      if (!following) fit();
    };
    map.on('resize', resized);
    return () => {
      map.off('resize', resized);
    };
  }, [map, following, fit]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [expanded]);
  const headline = delivered
    ? 'Ya llegamos.'
    : cancelled
      ? 'Seguimiento cerrado.'
      : atDestination
        ? 'Estamos en tu destino.'
        : inRoute
          ? 'Estamos en camino.'
          : 'Tu entrega comienza aquí.';
  const etaLabel = delivered
    ? 'Entregado'
    : cancelled
      ? 'Cancelado'
      : atDestination
        ? 'En destino'
        : currentEta?.minutes != null
          ? formatEta(currentEta.minutes)
          : inRoute
            ? 'Por actualizar'
            : 'Por confirmar';
  const referenceForm = (
    <form
      onSubmit={submit}
      className="flex w-full min-w-0 items-center gap-2"
      aria-label="Consultar seguimiento"
    >
      <label htmlFor="tracking-reference" className="sr-only">
        Número de seguimiento
      </label>
      <Input
        id="tracking-reference"
        value={reference}
        onChange={(event) => setReference(event.target.value.toUpperCase())}
        placeholder="Número de pedido o de OT"
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1"
      />
      <Button
        type="submit"
        size="sm"
        loading={isFetching}
        disabled={reference.trim().length < 4}
        icon={<Search size={15} />}
      >
        Consultar
      </Button>
      {data ? (
        <button
          type="button"
          onClick={() => setSearchOpen(false)}
          aria-label="Cerrar búsqueda"
          className="flex h-10 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
        >
          <XCircle size={16} />
        </button>
      ) : null}
    </form>
  );

  return (
    <div className="tracking-shell flex min-h-app min-w-0 flex-col bg-[#f3f6f4] text-[#173a38] md:h-app md:overflow-hidden">
      <header className="safe-top shrink-0 border-b border-[#dce7e1] bg-white/95">
        <div className="flex h-16 w-full items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="h-9 w-9 rounded-xl" />
            <div>
              <p className="text-[18px] font-bold tracking-tight text-[#173a38]">
                FENICE
                <span className="ml-2 text-[10px] font-normal uppercase tracking-[.2em] text-[#789087]">
                  SpA
                </span>
              </p>
              <p className="text-[10px] text-[#789087]">
                Cada entrega, más cerca.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 text-[11px] text-[#6e837d] sm:flex">
              <ShieldCheck size={14} /> Seguimiento de ubicación
            </span>
            {data?.simulated ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] text-amber-700">
                Demostración
              </span>
            ) : (
              <span className="hidden rounded-full border border-[#dce7e1] px-3 py-1 text-[10px] text-[#6e837d] md:block">
                Portal de seguimiento
              </span>
            )}
          </div>
        </div>
      </header>
      <main className="tracking-main safe-bottom flex w-full min-w-0 flex-1 flex-col gap-4 p-4 md:min-h-0 md:p-4 lg:p-5 xl:px-7">
        <div className="tracking-intro flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[9px] font-semibold uppercase tracking-[.2em] text-[#728d82]">
              Tu entrega en tiempo real
            </p>
            <h1 className="text-[25px] font-semibold leading-tight tracking-tight text-[#183e37] lg:text-[29px]">
              {data ? headline : 'El camino hasta ti.'}
            </h1>
          </div>
          {searchOpen && data ? (
            <div className="w-full md:max-w-[400px]">{referenceForm}</div>
          ) : data ? (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex h-10 items-center gap-2 rounded-xl border border-[#d9e4dd] bg-white px-3.5 text-xs font-medium text-[#48685c] hover:bg-[#eaf2ed]"
            >
              <Search size={14} /> Otro seguimiento
            </button>
          ) : null}
        </div>
        {!data ? (
          <section
            className="flex min-h-[380px] flex-1 items-center justify-center overflow-hidden rounded-[24px] border border-[#dce7e1] bg-white p-5 md:min-h-0"
            aria-label="Consulta de ubicación"
          >
            <div className="w-full max-w-[490px] text-center">
              <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[26px] bg-[#ecf4ef] text-[#246457]">
                <Navigation size={34} strokeWidth={1.4} />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-[#738d81]">
                FENICE · SEGUIMIENTO
              </p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Tu entrega, a la vista.
              </h2>
              <p className="mx-auto mt-3 max-w-[350px] text-sm leading-relaxed text-[#7b8e84]">
                Consulta la ubicación del vehículo y su llegada estimada con el
                número de tu pedido o de OT.
              </p>
              <div className="mt-7 rounded-2xl border border-[#dce7e1] bg-[#f8faf8] p-4">
                {referenceForm}
              </div>
              {isError ? (
                <div
                  role="alert"
                  className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800"
                >
                  {(error as Error).message}
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => void refetch()}
                  >
                    Reintentar
                  </button>
                </div>
              ) : submitted && isFetching ? (
                <Skeleton className="mt-4 h-3 w-full" />
              ) : null}
              <p className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-[#8b9b92]">
                <ShieldCheck size={13} /> Un mapa dedicado a tu entrega.
              </p>
            </div>
          </section>
        ) : (
          <>
            {isError ? (
              <div
                role="alert"
                className="flex shrink-0 items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
              >
                <span>
                  No pudimos actualizar la ubicación. Se conserva la última
                  información.
                </span>
                <button
                  type="button"
                  className="shrink-0 underline"
                  onClick={() => void refetch()}
                >
                  Reintentar
                </button>
              </div>
            ) : null}
            <div className="tracking-layout flex min-w-0 flex-1 flex-col gap-3 md:min-h-0 md:grid md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
              <aside
                className="contents md:flex md:min-h-0 md:flex-col md:gap-3"
                aria-label="Resumen de ubicación"
              >
                <section className="tracking-status order-0 shrink-0 overflow-hidden rounded-[20px] border border-[#dce7e1] bg-white p-5 md:order-none">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 rounded-full bg-[#edf5ee] px-2.5 py-1 text-[10px] font-semibold text-[#367358]">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {data.statusLabel}
                    </span>
                    <Truck size={18} className="text-[#668e7b]" />
                  </div>
                  <p className="text-[10px] text-[#789084]">
                    {delivered || cancelled || atDestination
                      ? 'Estado del seguimiento'
                      : 'Tiempo estimado de llegada'}
                  </p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <p className="tracking-eta numeric text-[36px] font-semibold leading-none tracking-tight text-[#184d3e]">
                      {etaLabel}
                    </p>
                    {currentEta?.arrivalAt && !atDestination && !delivered ? (
                      <span className="mb-0.5 text-right text-[10px] text-[#84978a]">
                        aprox.
                        <br />
                        <strong className="font-medium text-[#51765e]">
                          {formatTime(currentEta.arrivalAt)}
                        </strong>
                      </span>
                    ) : null}
                  </div>
                  <div className="tracking-metrics mt-4 grid grid-cols-2 gap-3 border-t border-[#edf1ed] pt-3">
                    <div>
                      <p className="flex items-center gap-1 text-[9px] text-[#819187]">
                        <Route size={11} /> Distancia al destino
                      </p>
                      <p className="numeric mt-1 text-[13px] font-semibold text-[#365f4f]">
                        {currentEta?.distanceKm != null &&
                        !atDestination &&
                        !delivered
                          ? `${currentEta.distanceKm.toLocaleString('es-CL', { maximumFractionDigits: 1 })} km`
                          : atDestination || delivered
                            ? 'En destino'
                            : 'Por actualizar'}
                      </p>
                    </div>
                    <div>
                      <p className="flex items-center gap-1 text-[9px] text-[#819187]">
                        <Truck size={11} /> Vehículo
                      </p>
                      <p className="numeric mt-1 truncate text-[13px] font-semibold text-[#365f4f]">
                        {delivered || cancelled ? 'Finalizado' : data.vehicle?.label ?? 'Por asignar'}
                      </p>
                    </div>
                  </div>
                  <ol
                    className="tracking-steps mt-4 flex justify-between gap-1 border-t border-[#edf1ed] pt-3"
                    aria-label="Avance de la entrega"
                  >
                    {['Preparado', 'En camino', 'En destino'].map(
                      (label, i) => {
                        const done =
                          !cancelled &&
                          (delivered || atDestination || (i === 0 && inRoute));
                        const active =
                          !cancelled &&
                          !delivered &&
                          (i === 0
                            ? !inRoute
                            : i === 1
                              ? inRoute && !atDestination
                              : atDestination);
                        return (
                          <li
                            key={label}
                            className="flex flex-1 flex-col items-center gap-1.5"
                            aria-current={active ? 'step' : undefined}
                          >
                            <span
                              className={cn(
                                'flex h-5 w-5 items-center justify-center rounded-full text-[9px]',
                                done
                                  ? 'bg-[#276c50] text-white'
                                  : active
                                    ? 'bg-[#e1f0e5] text-[#276c50] ring-2 ring-[#bedfc9]'
                                    : 'bg-[#f0f3ef] text-[#a0afa3]',
                              )}
                            >
                              {done ? <Check size={11} /> : i + 1}
                            </span>
                            <span className="text-[9px] text-[#7c8e81]">
                              {label}
                            </span>
                          </li>
                        );
                      },
                    )}
                  </ol>
                </section>
                <section className="tracking-destination order-2 shrink-0 rounded-2xl border border-[#dce7e1] bg-white p-4 md:order-none">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf4ed] text-[#518066]">
                      <MapPin size={18} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-[10px] font-medium text-[#829387]">
                        Punto de entrega
                      </h2>
                      <p
                        className="mt-1 line-clamp-2 text-[12px] font-semibold leading-snug text-[#3b6050]"
                        title={data.destination.addressLine}
                      >
                        {data.destination.addressLine}
                      </p>
                      <p className="mt-1 text-[10px] text-[#859788]">
                        {data.destination.communeName}
                        {data.arrival?.arrivedAt
                          ? ` · Llegada ${formatTime(data.arrival.arrivedAt)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                </section>
                <div className="order-3 flex min-h-[190px] flex-1 flex-col md:order-none md:min-h-0">
                  <TrackingCampaignCarousel
                    content={campaignContent ?? DEFAULT_TRACKING_CONTENT}
                  />
                </div>
              </aside>
              <section
                className={cn(
                  'tracking-map-card order-1 flex h-[480px] min-w-0 shrink-0 flex-col overflow-hidden rounded-[22px] border border-[#dce7e1] bg-white shadow-[0_5px_30px_rgba(26,62,47,.035)] md:order-none md:h-auto md:min-h-0',
                  expanded && 'fixed inset-3 z-50 !order-none !h-auto shadow-2xl',
                )}
                aria-label="Mapa del seguimiento"
              >
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#e4ece5] px-4 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#edf4ed] text-[#4a7b61]">
                      <Navigation size={14} />
                    </span>
                    <div>
                      <h2 className="text-[12px] font-semibold text-[#395e4d]">
                        {delivered || cancelled
                          ? 'Seguimiento finalizado'
                          : 'El trayecto hacia ti'}
                      </h2>
                      <p className="mt-0.5 text-[9px] text-[#8b9d8e]">
                        {delivered || cancelled
                          ? 'Gracias por acompañarnos.'
                          : 'Ubicación del vehículo y tu destino'}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 text-[10px]',
                      delayed && !delivered && !cancelled
                        ? 'text-amber-600'
                        : 'text-[#54816a]',
                    )}
                  >
                    <Radio size={12} />
                    {delivered || cancelled
                      ? 'Finalizado'
                      : delayed
                        ? 'Esperando GPS'
                        : 'Señal activa'}
                  </span>
                </div>
                {delivered || cancelled ? (
                  <div className="flex min-h-[340px] flex-1 flex-col items-center justify-center bg-[#f5f8f4] px-7 text-center md:min-h-0">
                    {delivered ? (
                      <CheckCircle2
                        size={60}
                        strokeWidth={1.3}
                        className="mb-5 text-[#4e8b68]"
                      />
                    ) : (
                      <XCircle
                        size={60}
                        strokeWidth={1.3}
                        className="mb-5 text-[#91a095]"
                      />
                    )}
                    <h3 className="text-2xl font-semibold tracking-tight text-[#2e5948]">
                      {delivered
                        ? 'Llegamos a tu destino.'
                        : 'El seguimiento ha finalizado.'}
                    </h3>
                    <p className="mt-3 max-w-[330px] text-sm leading-relaxed text-[#839386]">
                      {delivered
                        ? 'La ubicación del vehículo dejó de compartirse al finalizar la entrega.'
                        : 'La ubicación ya no está disponible para este seguimiento.'}
                    </p>
                    {delivered && data.deliveredAt ? (
                      <p className="mt-5 text-[11px] text-[#5a8169]">
                        Llegada registrada a las {formatTime(data.deliveredAt)}
                      </p>
                    ) : null}
                  </div>
                ) : data.destination.coordinates ? (
                  <div className="relative h-[420px] flex-1 md:h-auto md:min-h-0">
                    <ErrorBoundary section="el mapa de seguimiento">
                      <FleetMap
                        key={submitted}
                        autoFit
                        autoFitKey={`${submitted}:${vehiclePosition ? 'vehicle' : 'destination'}`}
                        isolated
                        minimalControls
                        highlightedRoute={TRACKING_ROUTE}
                        onMapReady={onMapReady}
                        viewModeOverride={satellite ? 'hybrid' : 'standard'}
                        className="absolute inset-0"
                        vehicles={
                          vehiclePosition && data.vehicle
                            ? [
                                {
                                  vehicleId: 'tracking-vehicle',
                                  plate: data.vehicle.label,
                                  fleetCode: '',
                                  status: delayed
                                    ? 'offline'
                                    : data.vehicle.moving
                                      ? 'moving'
                                      : 'stopped',
                                  position: {
                                    vehicleId: 'tracking-vehicle' as never,
                                    deviceId: 'tracking-device' as never,
                                    timestamp:
                                      data.vehicle.lastUpdateAt ??
                                      data.lastUpdateAt,
                                    ...vehiclePosition,
                                    speed: data.vehicle.speedKmh ?? 0,
                                    heading: data.vehicle.heading,
                                    ignition: 'unknown',
                                    valid: true,
                                  },
                                },
                              ]
                            : []
                        }
                        clients={[
                          {
                            clientId: 'tracking-destination',
                            code: '',
                            name: 'Punto de entrega',
                            ...data.destination.coordinates,
                            communeCode: '',
                            communeName: data.destination.communeName,
                            addressLine: data.destination.addressLine,
                            status: 'active',
                            daysSincePurchase: null,
                            daysSinceVisit: null,
                            hasPendingOrder: false,
                            visitedToday: false,
                            lifetimeValue: 0,
                            segment: 'estacion_servicio',
                            salesRep: null,
                          },
                        ]}
                        routes={
                          data.trajectory
                            ? [
                                {
                                  routeId: TRACKING_ROUTE,
                                  code: '',
                                  name: 'Trayecto hacia tu destino',
                                  vehicleId: 'tracking-vehicle',
                                  vehiclePlate: data.vehicle?.label ?? null,
                                  status: 'en_curso',
                                  plannedPath: data.trajectory,
                                  executedPath: [],
                                  stops: [],
                                },
                              ]
                            : []
                        }
                        geofences={[]}
                        alerts={[]}
                        workOrders={[]}
                        communes={[]}
                        heatmapPoints={[]}
                        layerOverride={{
                          camiones: true,
                          clientes: true,
                          rutas: true,
                          geocercas: false,
                          calor: false,
                          pedidos: false,
                          alertas: false,
                          comunas: false,
                        }}
                      />
                    </ErrorBoundary>
                    <div className="absolute left-3 top-3 flex max-w-[calc(100%-24px)] flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={fit}
                        className="tracking-map-button"
                      >
                        <Route size={13} /> Ver trayecto
                      </button>
                      {vehiclePosition ? (
                        <button
                          type="button"
                          aria-pressed={following}
                          onClick={() => {
                            if (!map || !vehiclePosition) return;
                            setFollowing(!following);
                            if (!following)
                              map.flyTo({
                                center: [
                                  vehiclePosition.lng,
                                  vehiclePosition.lat,
                                ],
                                zoom: 15,
                                duration: 650,
                              });
                          }}
                          className={cn(
                            'tracking-map-button',
                            following &&
                              '!border-[#648d76] !bg-[#edf6ef] !text-[#3f7155]',
                          )}
                        >
                          <Crosshair size={13} />
                          {following ? 'Siguiendo' : 'Seguir vehículo'}
                        </button>
                      ) : null}
                    </div>
                    <div
                      className={cn(
                        'absolute right-3 top-3 hidden flex-col gap-1.5 lg:flex',
                        expanded && '!flex',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSatellite((value) => !value)}
                        aria-label={
                          satellite
                            ? 'Ver mapa de calles'
                            : 'Ver mapa satelital'
                        }
                        className="tracking-map-icon"
                      >
                        <Layers size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setExpanded((value) => !value)}
                        aria-label={
                          expanded ? 'Salir de mapa ampliado' : 'Ampliar mapa'
                        }
                        className="tracking-map-icon"
                      >
                        {expanded ? (
                          <Minimize2 size={16} />
                        ) : (
                          <Maximize2 size={16} />
                        )}
                      </button>
                    </div>
                    <div className="absolute bottom-12 right-3 flex flex-col overflow-hidden rounded-xl border border-[#dce7e1] bg-white/95 shadow-sm">
                      <button
                        type="button"
                        onClick={() => map?.zoomIn()}
                        aria-label="Acercar mapa"
                        className="tracking-map-icon !rounded-none !border-0"
                      >
                        <Plus size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => map?.zoomOut()}
                        aria-label="Alejar mapa"
                        className="tracking-map-icon !rounded-none !border-0 border-t"
                      >
                        <Minus size={17} />
                      </button>
                    </div>
                    {data.vehicle && delayed ? (
                      <div className="absolute bottom-10 left-3 right-16 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
                        <WifiOff size={14} className="shrink-0" />
                        <p>
                          Esperando una nueva ubicación.
                          {age !== null
                            ? ` Último registro: ${formatElapsed(age)}.`
                            : ''}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex min-h-[340px] flex-1 flex-col items-center justify-center bg-[#f5f8f4] p-8 text-center md:min-h-0">
                    <MapPin size={40} className="mb-4 text-[#8da994]" />
                    <h3 className="text-lg font-semibold text-[#436c51]">
                      Estamos preparando tu ubicación.
                    </h3>
                    <p className="mt-2 max-w-[300px] text-sm text-[#89998a]">
                      El mapa estará disponible cuando se confirme el punto de
                      entrega.
                    </p>
                  </div>
                )}
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#e4ece5] px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[9px] text-[#819487]">
                    <span className="w-5 border-t-2 border-dashed border-[#296e60]" />
                    {delivered || cancelled
                      ? 'Ubicación protegida'
                      : data.trajectory
                        ? 'Trayecto previsto al destino'
                        : 'Punto de entrega'}
                  </span>
                  <span className="flex items-center gap-1 text-[9px] text-[#819487]">
                    <Clock size={11} />
                    {age === null || delivered || cancelled
                      ? 'Seguimiento de ubicación'
                      : `GPS: ${formatElapsed(age)}`}
                  </span>
                </div>
              </section>
            </div>
          </>
        )}
        <footer className="tracking-footer flex shrink-0 flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-[#8a9b8d]">
          <p className="flex items-center gap-1.5">
            <ShieldCheck size={12} />
            Solo tu destino y el vehículo asignado.
          </p>
          {data ? (
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 hover:text-[#3a7256]"
            >
              <RefreshCw
                size={11}
                className={cn(isFetching && 'animate-spin')}
              />
              {isFetching
                ? 'Actualizando'
                : `Actualizado ${formatTime(data.lastUpdateAt)}`}
            </button>
          ) : (
            <span>FENICE · Seguimiento</span>
          )}
        </footer>
      </main>
    </div>
  );
}
