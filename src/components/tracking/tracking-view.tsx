'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Crosshair,
  MapPin,
  Navigation,
  Package,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Timer,
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
import { Skeleton } from '@/components/ui/skeleton';
import { useAppHeight } from '@/hooks/use-app-height';
import {
  formatDuration,
  formatElapsed,
  formatEta,
  formatSmartDateTime,
  formatTime,
} from '@/lib/format';
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
  const [searchOpen, setSearchOpen] = useState(!presetReference);
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
  const fit = () => {
    if (!map || !data) return;
    const points = [
      ...(data.trajectory ?? []),
      ...(vehiclePosition ? [vehiclePosition] : []),
      ...(data.destination.coordinates ? [data.destination.coordinates] : []),
    ];
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
      { padding: 70, maxZoom: 15, duration: 600 },
    );
    setFollowing(false);
  };
  return (
    <div className="min-h-app bg-surface-950">
      <header className="safe-top border-b border-line bg-surface-900">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <BrandMark className="h-8 w-8" />
            <div>
              <p className="text-sm font-semibold text-ink">
                Fenice{' '}
                <span className="font-normal text-ink-faint">
                  · Seguimiento
                </span>
              </p>
              <p className="text-[10px] text-ink-faint">
                Tu entrega, a la vista
              </p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 text-xs text-ink-faint sm:flex">
            <ShieldCheck className="h-4 w-4" />
            Información de tu pedido
          </span>
        </div>
      </header>
      <main className="safe-bottom mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[.18em] text-brand-700">
              Seguimiento de entrega
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              {submitted ? 'El camino de tu pedido' : '¿Dónde está tu pedido?'}
            </h1>
            <p className="mt-2 text-xs text-ink-muted">
              Estado del despacho y ubicación del vehículo asignado.
            </p>
          </div>
          {!searchOpen ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<Search className="h-3.5 w-3.5" />}
              onClick={() => setSearchOpen(true)}
            >
              Buscar otro pedido
            </Button>
          ) : null}
        </div>
        {searchOpen ? (
          <form
            onSubmit={submit}
            className="mb-6 max-w-xl rounded-xl border border-line bg-surface-900 p-4"
          >
            <label
              htmlFor="tracking-reference"
              className="mb-2 block text-xs font-medium text-ink"
            >
              Número de pedido u orden de trabajo
            </label>
            <div className="flex gap-2">
              <Input
                id="tracking-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value.toUpperCase())}
                placeholder="Ej. OT-2026-001582"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="submit"
                loading={isFetching}
                disabled={reference.trim().length < 4}
                icon={<Search className="h-4 w-4" />}
              >
                Buscar
              </Button>
            </div>
            <p className="mt-2 text-[10px] text-ink-faint">
              Usa el número de tu documento de despacho.
            </p>
          </form>
        ) : null}
        {submitted.trim().length < 4 ? (
          <div className="grid gap-6 rounded-2xl border border-line bg-surface-900 p-7 sm:grid-cols-2 sm:p-12">
            <div>
              <Package className="mb-5 h-10 w-10 text-brand-700" />
              <h2 className="text-xl font-semibold text-ink">
                Acompañamos tu entrega
              </h2>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
                Consulta el avance del pedido, la hora estimada de llegada y la
                visita a tu domicilio.
              </p>
            </div>
            <div className="space-y-4 self-center">
              {[
                [Package, 'Pedido preparado'],
                [Truck, 'Vehículo en camino'],
                [CheckCircle2, 'Entrega en tu domicilio'],
              ].map(([Icon, label], i) => {
                const StepIcon = Icon as typeof Package;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl bg-surface-850 p-4"
                  >
                    <StepIcon className="h-5 w-5 text-ink-faint" />
                    <p className="text-sm text-ink">{String(label)}</p>
                    <ArrowRight className="ml-auto h-4 w-4 text-ink-faint" />
                  </div>
                );
              })}
            </div>
          </div>
        ) : !data && isError ? (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center"
          >
            <p className="font-medium text-ink">{(error as Error).message}</p>
            <p className="mt-2 text-xs text-ink-muted">
              Revisa la referencia o consulta a tu ejecutivo comercial.
            </p>
            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => void refetch()}
            >
              Reintentar
            </Button>
          </div>
        ) : !data ? (
          <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
            <Skeleton className="h-[500px]" />
            <Skeleton className="h-[580px]" />
          </div>
        ) : (
          <>
            {data.simulated ? (
              <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                Demostración: este pedido y sus posiciones son datos de prueba.
              </p>
            ) : null}
            {isError ? (
              <p
                role="alert"
                className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800"
              >
                No pudimos actualizar el pedido. Se conserva la última
                información recibida.
                <button
                  className="ml-2 underline"
                  onClick={() => void refetch()}
                >
                  Reintentar
                </button>
              </p>
            ) : null}
            <section className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-[#102b46] p-4 text-white lg:hidden">
              <div>
                <p className="text-[10px] text-slate-300">{data.statusLabel}</p>
                <p className="numeric mt-1 text-xs font-medium">
                  {data.orderNumber}
                </p>
                {currentEta?.arrivalAt ? (
                  <p className="mt-1 text-[10px] text-slate-300">
                    Llegada aprox. {formatTime(currentEta.arrivalAt)}
                  </p>
                ) : null}
              </div>
              <p className="text-2xl font-semibold">
                {delivered
                  ? 'Entregado'
                  : cancelled
                    ? 'Cancelado'
                    : atDestination
                      ? 'En destino'
                      : currentEta?.minutes != null
                        ? formatEta(currentEta.minutes)
                        : inRoute
                          ? 'En camino'
                          : 'Preparando'}
              </p>
            </section>
            <div className="grid items-start gap-5 lg:grid-cols-[350px_minmax(0,1fr)]">
              <aside className="order-2 space-y-4 lg:order-1">
                <section className="overflow-hidden rounded-xl border border-line bg-surface-900 shadow-card">
                  <div className="hidden bg-[#102b46] p-5 text-white lg:block">
                    <div className="mb-4 flex items-center gap-2 text-xs text-slate-300">
                      {cancelled ? (
                        <XCircle className="h-4 w-4" />
                      ) : delivered ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <Truck className="h-4 w-4 text-cyan-200" />
                      )}
                      {data.statusLabel}
                    </div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-300">
                      {delivered
                        ? 'Entrega finalizada'
                        : cancelled
                          ? 'Pedido cancelado'
                          : atDestination
                            ? 'Vehículo en el domicilio'
                            : 'Llegada estimada'}
                    </p>
                    <p className="mt-1 text-3xl font-semibold tracking-tight">
                      {delivered
                        ? 'Entregado'
                        : cancelled
                          ? 'Cancelado'
                          : atDestination
                            ? 'En destino'
                            : currentEta?.minutes != null
                              ? formatEta(currentEta.minutes)
                              : inRoute
                                ? 'En actualización'
                                : 'En preparación'}
                    </p>
                    {currentEta?.arrivalAt && !delivered ? (
                      <p className="mt-2 text-xs text-slate-300">
                        Hora aproximada: {formatTime(currentEta.arrivalAt)}
                      </p>
                    ) : null}
                    {delivered && data.deliveredAt ? (
                      <p className="mt-2 text-xs text-slate-300">
                        {formatSmartDateTime(data.deliveredAt)}
                      </p>
                    ) : null}
                  </div>
                  <div className="p-5">
                    <p className="text-[10px] uppercase tracking-wider text-ink-faint">
                      Pedido
                    </p>
                    <p className="numeric mt-1 text-sm font-semibold text-ink">
                      {data.orderNumber}
                    </p>
                    <p className="mt-1 text-[10px] text-ink-faint">
                      Orden {data.workOrderNumber}
                    </p>
                    <ol className="mt-5 space-y-5">
                      {[
                        ['Preparación', 'Tu pedido está registrado'],
                        ['En camino', 'El vehículo va hacia tu domicilio'],
                        [
                          'Entrega',
                          delivered
                            ? 'Entrega registrada'
                            : 'Pendiente de llegada',
                        ],
                      ].map(([title, detail], index) => {
                        const done =
                          !cancelled && (delivered || (index === 0 && inRoute));
                        const active =
                          !cancelled &&
                          !delivered &&
                          (index === 0
                            ? !inRoute
                            : index === 1
                              ? inRoute
                              : atDestination);
                        return (
                          <li key={title} className="flex items-center gap-3">
                            <span
                              className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs',
                                done
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : active
                                    ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                                    : 'border-line text-ink-faint',
                              )}
                            >
                              {done ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                index + 1
                              )}
                            </span>
                            <div>
                              <p className="text-xs font-medium text-ink">
                                {title}
                              </p>
                              <p className="mt-0.5 text-[10px] text-ink-faint">
                                {detail}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                </section>
                <section className="rounded-xl border border-line bg-surface-900 p-5">
                  <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                    <MapPin className="h-4 w-4 text-brand-700" />
                    Tu dirección de entrega
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    {data.destination.addressLine}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {data.destination.communeName}
                  </p>
                </section>
                {data.arrival ? (
                  <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                    <p className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                      <Timer className="h-4 w-4" />
                      Visita al domicilio
                    </p>
                    <p className="mt-2 text-xs text-emerald-800">
                      Llegó a las {formatTime(data.arrival.arrivedAt)}
                      {data.arrival.departedAt
                        ? ` · salió a las ${formatTime(data.arrival.departedAt)}`
                        : ''}
                    </p>
                    {data.arrival.dwellMinutes != null ? (
                      <p className="mt-1 text-xs text-emerald-700">
                        {formatDuration(data.arrival.dwellMinutes * 60)} en el
                        lugar
                      </p>
                    ) : null}
                  </section>
                ) : null}
              </aside>
              <div className="order-1 space-y-3 lg:order-2">
                <section className="overflow-hidden rounded-xl border border-line bg-surface-900 shadow-card">
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <div>
                      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                        <Navigation className="h-4 w-4 text-brand-700" />
                        {delivered
                          ? 'Entrega finalizada'
                          : cancelled
                            ? 'Seguimiento finalizado'
                            : 'Mapa de tu entrega'}
                      </p>
                      <p className="mt-1 text-[10px] text-ink-faint">
                        {data.vehicle
                          ? `Vehículo ${data.vehicle.label}`
                          : 'Destino del pedido'}
                      </p>
                    </div>
                    {!delivered && !cancelled && data.vehicle ? (
                      <span
                        className={cn(
                          'flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px]',
                          delayed
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-emerald-50 text-emerald-700',
                        )}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        {delayed
                          ? 'Actualizando señal'
                          : data.vehicle.moving && !delayed
                            ? 'En movimiento'
                            : 'Detenido'}
                      </span>
                    ) : null}
                  </div>
                  {delivered || cancelled ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center bg-surface-850 px-8 text-center">
                      {delivered ? (
                        <CheckCircle2 className="mb-5 h-14 w-14 text-emerald-600" />
                      ) : (
                        <XCircle className="mb-5 h-14 w-14 text-ink-faint" />
                      )}
                      <h2 className="text-xl font-semibold text-ink">
                        {delivered
                          ? 'Tu entrega ya está registrada'
                          : 'Este pedido está cancelado'}
                      </h2>
                      <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
                        {delivered
                          ? 'El seguimiento del vehículo terminó al entregar tu pedido.'
                          : 'Consulta a tu ejecutivo comercial para conocer los siguientes pasos.'}
                      </p>
                      <p className="mt-5 flex items-center gap-1.5 text-xs text-ink-faint">
                        <ShieldCheck className="h-4 w-4" />
                        La ubicación del vehículo ya no se comparte.
                      </p>
                    </div>
                  ) : data.destination.coordinates ? (
                    <div className="relative h-[380px] sm:h-[560px]">
                      <ErrorBoundary section="el mapa de seguimiento">
                        <FleetMap
                          key={submitted}
                          autoFit
                          autoFitKey={`${submitted}:${vehiclePosition ? 'vehicle' : 'destination'}`}
                          isolated
                          highlightedRoute={TRACKING_ROUTE}
                          onMapReady={onMapReady}
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
                                      lat: vehiclePosition.lat,
                                      lng: vehiclePosition.lng,
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
                              name: 'Tu entrega',
                              lat: data.destination.coordinates.lat,
                              lng: data.destination.coordinates.lng,
                              communeCode: '',
                              communeName: data.destination.communeName,
                              addressLine: data.destination.addressLine,
                              status: 'active',
                              daysSincePurchase: null,
                              daysSinceVisit: null,
                              hasPendingOrder: true,
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
                                    name: 'Trayecto hacia tu domicilio',
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
                      <div className="absolute left-3 top-3 flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Route className="h-3.5 w-3.5" />}
                          onClick={fit}
                        >
                          Ver trayecto
                        </Button>
                        {vehiclePosition ? (
                          <Button
                            size="sm"
                            variant={following ? 'primary' : 'secondary'}
                            icon={<Crosshair className="h-3.5 w-3.5" />}
                            onClick={() => setFollowing(!following)}
                          >
                            {following ? 'Siguiendo' : 'Seguir vehículo'}
                          </Button>
                        ) : null}
                      </div>
                      {data.vehicle && delayed ? (
                        <div className="absolute bottom-9 left-3 right-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/95 px-3 py-2 text-xs text-amber-800">
                          <WifiOff className="h-4 w-4 shrink-0" />
                          <p>
                            Esperamos una nueva posición del GPS.
                            {age !== null
                              ? ` Última muestra: ${formatElapsed(age)}.`
                              : ''}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex h-[380px] flex-col items-center justify-center p-8 text-center">
                      <MapPin className="mb-3 h-9 w-9 text-ink-faint" />
                      <p className="text-sm text-ink-muted">
                        La dirección todavía no tiene coordenadas para mostrar
                        el mapa.
                      </p>
                    </div>
                  )}
                  {!delivered && !cancelled ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 text-[10px] text-ink-faint">
                      <span className="flex items-center gap-2">
                        <span className="w-5 border-t-2 border-dashed border-[#173f67]" />
                        {data.trajectory
                          ? 'Trayecto planificado hacia tu domicilio'
                          : 'Destino de tu entrega'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {age === null
                          ? 'Esperando señal GPS'
                          : `GPS: ${formatElapsed(age)}`}
                      </span>
                    </div>
                  ) : null}
                </section>
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] text-ink-faint">
                  <p className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Solo mostramos tu pedido y el trayecto hacia tu domicilio.
                  </p>
                  <button
                    onClick={() => void refetch()}
                    disabled={isFetching}
                    className="flex items-center gap-1.5 hover:text-ink"
                  >
                    <RefreshCw
                      className={cn('h-3 w-3', isFetching && 'animate-spin')}
                    />
                    {isFetching
                      ? 'Actualizando'
                      : `Actualizado ${formatTime(data.lastUpdateAt)}`}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
