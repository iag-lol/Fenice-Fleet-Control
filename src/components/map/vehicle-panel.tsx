'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  Clock,
  Crosshair,
  ExternalLink,
  Gauge,
  History,
  Info,
  ListChecks,
  MapPin,
  Navigation,
  Power,
  PowerOff,
  Route as RouteIcon,
  Square,
  Truck,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { DetailList, Section } from '@/components/common/detail-list';
import { RouteProgress } from '@/components/common/progress';
import {
  ConnectionBadge,
  DeliveryConfirmationBadge,
  VehicleStatusBadge,
  WorkOrderStatusBadge,
} from '@/components/common/status';
import { Timeline } from '@/components/common/timeline';
import { Button, LinkButton } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { systemModeQuery } from '@/hooks/use-control-data';
import { useVehicleTrajectory, type TrajectoryEventType } from '@/hooks/use-vehicle-trajectory';
import {
  formatCoordinates,
  formatDuration,
  formatElapsed,
  formatEta,
  formatHeading,
  formatKm,
  formatSpeed,
  formatTime,
  formatTimeWithSeconds,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { useMapStore } from '@/stores/map-store';
import type { VehicleDetail } from '@/types/views';

const DEFAULT_MAX_LEGAL_SPEED_KMH = 60;

type PanelTab = 'informacion' | 'actividad' | 'ordenes' | 'alertas';

const TRAJECTORY_EVENT_ICON: Record<TrajectoryEventType, typeof Square> = {
  stop: Square,
  speeding: AlertTriangle,
  ignition_on: Power,
  ignition_off: PowerOff,
};

const TRAJECTORY_EVENT_TONE: Record<TrajectoryEventType, string> = {
  stop: 'text-status-warning',
  speeding: 'text-status-warning',
  ignition_on: 'text-status-active',
  ignition_off: 'text-ink-faint',
};

/**
 * Ficha operacional del vehiculo.
 *
 * Se abre al tocar un camion en el mapa. Responde las preguntas que la
 * operacion hace en ese momento: donde esta, que lleva, a quien va, cuanto
 * falta y como viene la ruta.
 */
export function VehiclePanel({ vehicleId }: { vehicleId: string }) {
  const { positions } = useLiveFleet();
  const focusOn = useMapStore((s) => s.focusOn);
  const followVehicle = useMapStore((s) => s.followVehicle);
  const following = useMapStore((s) => s.followingVehicleId);
  const highlightRoute = useMapStore((s) => s.highlightRoute);
  const highlightedRouteId = useMapStore((s) => s.highlightedRouteId);
  const [tab, setTab] = useState<PanelTab>('informacion');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vehicle', vehicleId],
    refetchInterval: 30_000,
    queryFn: async (): Promise<VehicleDetail> => {
      const response = await fetch(`/api/fleet/${vehicleId}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No fue posible obtener el detalle del vehiculo.');
      }
      return (await response.json()) as VehicleDetail;
    },
  });

  const { data: mode } = useQuery(systemModeQuery);
  const maxLegalSpeedKmh = mode?.settings.route.maxLegalSpeedKmh ?? DEFAULT_MAX_LEGAL_SPEED_KMH;
  const {
    trajectory,
    isLoading: trajectoryLoading,
    isError: trajectoryError,
  } = useVehicleTrajectory(vehicleId, data?.vehicle.plate ?? null, maxLegalSpeedKmh);

  if (isError) {
    return (
      <div className="p-4">
        <QueryError
          title="No fue posible cargar el vehiculo"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-4">
        <SkeletonRows rows={7} />
      </div>
    );
  }

  // La posicion viva del stream tiene prioridad sobre la de la consulta.
  const position = positions.get(vehicleId) ?? data.snapshot.position;
  const { vehicle, driver, currentWorkOrder, nextWorkOrder, route, journey, eta } = data;
  const isFollowing = following === vehicleId;
  const ordersCount = (currentWorkOrder ? 1 : 0) + (nextWorkOrder ? 1 : 0);
  const alertsCount = data.openAlerts.length;

  const TABS: { id: PanelTab; label: string; icon: typeof Info; count?: number }[] = [
    { id: 'informacion', label: 'Información', icon: Info },
    { id: 'actividad', label: 'Actividad', icon: History },
    { id: 'ordenes', label: 'Órdenes', icon: ListChecks, count: ordersCount },
    { id: 'alertas', label: 'Alertas', icon: Bell, count: alertsCount },
  ];

  return (
    <div className="flex flex-col">
      <div className="space-y-5 p-4 pb-4">
      {/* --- Encabezado --- */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-ink">{vehicle.plate}</h3>
            <span className="numeric rounded bg-surface-750 px-1.5 py-0.5 text-2xs text-brand-700">
              {vehicle.fleetCode}
            </span>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            {vehicle.brand} {vehicle.model} · {vehicle.year}
          </p>
        </div>
        <VehicleStatusBadge status={data.snapshot.status} size="md" />
      </div>

      {/* --- Acciones --- */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant={isFollowing ? 'primary' : 'secondary'}
          size="sm"
          icon={<Navigation className="h-3.5 w-3.5" />}
          onClick={() => followVehicle(isFollowing ? null : vehicleId)}
          disabled={!position}
        >
          {isFollowing ? 'Dejar de seguir' : 'Seguir vehiculo'}
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={<Crosshair className="h-3.5 w-3.5" />}
          onClick={() => position && focusOn({ lat: position.lat, lng: position.lng }, 15.5)}
          disabled={!position}
        >
          Centrar vehiculo
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={<RouteIcon className="h-3.5 w-3.5" />}
          onClick={() => route && highlightRoute(highlightedRouteId === route.routeId ? null : route.routeId)}
          disabled={!route}
        >
          {route && highlightedRouteId === route.routeId ? 'Quitar ruta' : 'Ver ruta'}
        </Button>

        <LinkButton
          href={`/flota/${vehicleId}`}
          variant="secondary"
          size="sm"
          icon={<History className="h-3.5 w-3.5" />}
        >
          Ver historial
        </LinkButton>
      </div>
      </div>

      {/* --- Pestañas --- */}
      <div className="flex shrink-0 border-b border-line px-2" aria-label="Secciones del vehículo">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.id;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-pressed={active}
              className={cn(
                'flex min-h-11 flex-1 items-center justify-center gap-1.5 border-b-2 px-1 text-xs font-medium transition-colors',
                active ? 'border-brand-600 text-brand-700' : 'border-transparent text-ink-faint hover:text-ink',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{entry.label}</span>
              {typeof entry.count === 'number' && entry.count > 0 ? (
                <span
                  className={cn(
                    'numeric shrink-0 rounded px-1 text-[10px] font-semibold',
                    active ? 'bg-brand-500/15 text-brand-700' : 'bg-surface-750 text-ink-faint',
                  )}
                >
                  {entry.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="space-y-5 p-4 pb-6">
      {tab === 'informacion' ? (
      <>
      {/* --- Telemetria --- */}
      <Section title="Vehiculo">
        <DetailList
          items={[
            {
              label: 'Velocidad',
              value: (
                <span className="numeric flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5 text-ink-faint" />
                  {formatSpeed(position?.speed ?? null)}
                </span>
              ),
            },
            {
              label: 'Ignicion',
              value:
                position?.ignition === 'on'
                  ? 'Encendida'
                  : position?.ignition === 'off'
                    ? 'Apagada'
                    : 'Sin dato',
            },
            { label: 'Rumbo', value: formatHeading(position?.heading) },
            { label: 'Comuna aproximada', value: journey.communeName ?? 'Sin determinar' },
            {
              label: 'Ultima actualizacion',
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="numeric">
                    {formatElapsed(data.snapshot.device?.secondsSinceLastPosition ?? null)}
                  </span>
                  {data.snapshot.device ? (
                    <ConnectionBadge state={data.snapshot.device.connection} />
                  ) : null}
                </span>
              ),
              full: true,
            },
            {
              label: 'Conductor',
              value: driver ? (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-ink-faint" />
                  {driver.fullName}
                </span>
              ) : (
                'Sin conductor asignado'
              ),
              full: true,
            },
            {
              label: 'Coordenadas',
              value: position ? (
                <span className="numeric text-xs">{formatCoordinates(position.lat, position.lng)}</span>
              ) : (
                'Sin posicion'
              ),
              full: true,
            },
          ]}
        />
      </Section>

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Truck className="h-3.5 w-3.5 text-ink-faint" />
        <p className="text-2xs text-ink-faint">
          Equipo {vehicle.device?.model ?? 'no instalado'}
          {vehicle.device ? ` · IMEI ${vehicle.device.imei}` : ''}
        </p>
      </div>
      </>
      ) : null}

      {tab === 'ordenes' ? (
      <>
      {/* --- Orden actual --- */}
      <Section title="Orden actual">
        {currentWorkOrder ? (
          <div className="rounded-md border border-line bg-surface-800 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  prefetch={false}
                  href={`/ordenes/${currentWorkOrder.id}`}
                  className="numeric inline-flex min-h-11 items-center truncate text-[13px] font-semibold text-brand-700 hover:underline sm:min-h-0"
                >
                  {currentWorkOrder.number}
                </Link>
                <p className="numeric truncate text-2xs text-ink-faint">
                  Pedido {currentWorkOrder.orderNumber}
                </p>
              </div>
              <WorkOrderStatusBadge status={currentWorkOrder.status} />
            </div>

            <p className="mt-2 truncate text-[13px] font-medium text-ink">
              {currentWorkOrder.clientName}
            </p>
            <p className="flex items-start gap-1.5 text-2xs text-ink-faint">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0">
                {currentWorkOrder.addressLine}, {currentWorkOrder.communeName}
              </span>
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-2.5">
              <div>
                <p className="text-2xs uppercase tracking-wider text-ink-faint">Hora prevista</p>
                <p className="numeric mt-0.5 text-[13px] text-ink">
                  {formatTime(currentWorkOrder.scheduledWindowStart)}
                </p>
              </div>
              <div>
                <p className="text-2xs uppercase tracking-wider text-ink-faint">ETA</p>
                <p className="numeric mt-0.5 flex items-center gap-1.5 text-[13px] text-brand-700">
                  <Clock className="h-3.5 w-3.5" />
                  {formatEta(eta?.minutes ?? null)}
                </p>
              </div>
            </div>

            <DeliveryConfirmationBadge source={currentWorkOrder.deliveryConfirmation} />
          </div>
        ) : nextWorkOrder ? (
          <div className="rounded-md border border-line bg-surface-800 p-3">
            <p className="text-2xs uppercase tracking-wider text-ink-faint">Proxima entrega</p>
            <Link
              prefetch={false}
              href={`/ordenes/${nextWorkOrder.id}`}
              className="numeric mt-1 flex min-h-11 items-center truncate text-[13px] font-semibold text-brand-700 hover:underline sm:block sm:min-h-0"
            >
              {nextWorkOrder.number}
            </Link>
            <p className="truncate text-[13px] text-ink">{nextWorkOrder.clientName}</p>
            <p className="truncate text-2xs text-ink-faint">
              {nextWorkOrder.addressLine}, {nextWorkOrder.communeName}
            </p>
          </div>
        ) : (
          <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
            Este vehiculo no tiene una orden de trabajo en ejecucion en este momento.
          </p>
        )}
      </Section>

      {/* --- Progreso de ruta --- */}
      {route ? (
        <Section
          title="Progreso de ruta"
          action={
            <Link
              prefetch={false}
              href={`/rutas/${route.routeId}`}
              className="flex min-h-11 items-center gap-1 text-2xs text-brand-700 hover:underline sm:min-h-0"
            >
              {route.code} <ExternalLink className="h-3 w-3" />
            </Link>
          }
        >
          <RouteProgress
            completed={data.routeProgress.completedStops}
            total={data.routeProgress.totalStops}
          />

          <ol className="mt-3 space-y-1.5">
            {route.stops.map((stop) => {
              const visited = stop.status === 'visita_detectada' || stop.status === 'completada';
              const isNext = stop.status === 'proxima' || stop.status === 'en_cliente';

              return (
                <li key={stop.workOrderId} className="flex items-center gap-2.5">
                  <span
                    className={
                      visited
                        ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-active/20 text-[10px] font-semibold text-status-active'
                        : isNext
                          ? 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-warning/20 text-[10px] font-semibold text-status-warning'
                          : 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px] text-ink-faint'
                    }
                  >
                    {visited ? '✓' : stop.sequence}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={
                        visited
                          ? 'block truncate text-xs text-ink-muted'
                          : isNext
                            ? 'block truncate text-xs font-medium text-ink'
                            : 'block truncate text-xs text-ink-faint'
                      }
                    >
                      {stop.clientName}
                    </span>
                  </span>
                  <span className="numeric shrink-0 text-2xs text-ink-faint">
                    {visited
                      ? formatTime(stop.actualArrivalAt)
                      : isNext
                        ? 'Proximo'
                        : formatTime(stop.plannedArrivalAt)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}
      {!currentWorkOrder && !nextWorkOrder && !route ? (
        <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
          Este vehiculo no tiene una ruta asignada en este momento.
        </p>
      ) : null}
      </>
      ) : null}

      {tab === 'actividad' ? (
      <>
      {/* --- Recorrido --- */}
      <Section title="Recorrido de la jornada">
        <DetailList
          columns={2}
          items={[
            { label: 'Kilometros recorridos', value: <span className="numeric">{formatKm(journey.distanceKm)}</span> },
            { label: 'Inicio de ruta', value: <span className="numeric">{formatTime(journey.startedAt)}</span> },
            {
              label: 'Tiempo en movimiento',
              value: <span className="numeric">{formatDuration(journey.movingSeconds)}</span>,
            },
            {
              label: 'Tiempo detenido',
              value: <span className="numeric">{formatDuration(journey.stoppedSeconds)}</span>,
            },
            {
              label: 'Entregas realizadas',
              value: <span className="numeric">{journey.deliveriesCompleted}</span>,
            },
            {
              label: 'Entregas pendientes',
              value: <span className="numeric">{journey.deliveriesPending}</span>,
            },
          ]}
        />
      </Section>

      {/* --- Trayecto del dia --- */}
      <Section title="Eventos del trayecto (00:00 - 23:59)">
        {trajectoryLoading ? (
          <p className="text-2xs text-ink-faint">Cargando trayecto del dia...</p>
        ) : trajectoryError ? (
          <p className="text-2xs text-status-warning">
            No fue posible cargar el trayecto del dia de este vehiculo.
          </p>
        ) : trajectory && trajectory.events.length > 0 ? (
          <ul className="space-y-1.5">
            {trajectory.events.map((event) => {
              const Icon = TRAJECTORY_EVENT_ICON[event.type];
              return (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => focusOn(event.position, 16)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-line bg-surface-800 px-3 py-2 text-left hover:border-brand-500/40"
                  >
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', TRAJECTORY_EVENT_TONE[event.type])} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ink">{event.title}</span>
                      <span className="block truncate text-2xs text-ink-faint">{event.detail}</span>
                    </span>
                    <span className="numeric shrink-0 text-2xs text-ink-faint">
                      {formatTimeWithSeconds(event.at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
            Sin eventos registrados en el trayecto de hoy.
          </p>
        )}
      </Section>

      {/* --- Historial --- */}
      <Section title="Historial de la jornada">
        <Timeline
          entries={data.timeline.slice(0, 14)}
          onFocus={(entry) => entry.position && focusOn(entry.position, 16)}
        />
      </Section>
      </>
      ) : null}

      {tab === 'alertas' ? (
      <>
      {data.openAlerts.length > 0 ? (
        <ul className="space-y-1.5">
          {data.openAlerts.map((alert) => (
            <li
              key={alert.id}
              className="rounded-md border border-status-warning/25 bg-status-warning/5 px-3 py-2"
            >
              <p className="text-xs font-medium text-ink">{alert.title}</p>
              <p className="mt-0.5 text-2xs leading-relaxed text-ink-faint">{alert.description}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
          Este vehiculo no tiene alertas abiertas en este momento.
        </p>
      )}
      </>
      ) : null}
      </div>
    </div>
  );
}
