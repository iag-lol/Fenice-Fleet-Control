'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Clock,
  Crosshair,
  ExternalLink,
  Gauge,
  History,
  MapPin,
  Navigation,
  Route as RouteIcon,
  Truck,
  User,
} from 'lucide-react';
import Link from 'next/link';

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
import {
  formatCoordinates,
  formatDuration,
  formatElapsed,
  formatEta,
  formatHeading,
  formatKm,
  formatSpeed,
  formatTime,
} from '@/lib/format';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { useMapStore } from '@/stores/map-store';
import type { VehicleDetail } from '@/types/views';

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

  return (
    <div className="space-y-5 p-4 pb-6">
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

      {/* --- Historial --- */}
      <Section title="Historial de la jornada">
        <Timeline
          entries={data.timeline.slice(0, 14)}
          onFocus={(entry) => entry.position && focusOn(entry.position, 16)}
        />
      </Section>

      {data.openAlerts.length > 0 ? (
        <Section title={`Alertas abiertas (${data.openAlerts.length})`}>
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
        </Section>
      ) : null}

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Truck className="h-3.5 w-3.5 text-ink-faint" />
        <p className="text-2xs text-ink-faint">
          Equipo {vehicle.device?.model ?? 'no instalado'}
          {vehicle.device ? ` · IMEI ${vehicle.device.imei}` : ''}
        </p>
      </div>
    </div>
  );
}
