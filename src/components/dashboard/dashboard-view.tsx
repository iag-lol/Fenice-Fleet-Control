'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  MoonStar,
  Radar,
  Route as RouteIcon,
} from 'lucide-react';
import Link from 'next/link';

import { AttentionBoard } from '@/components/dashboard/attention-board';
import { DayProgress } from '@/components/dashboard/day-progress';
import { FleetPulse } from '@/components/dashboard/fleet-pulse';
import { PlanOverview } from '@/components/product/plan-overview';
import { PageHeader } from '@/components/common/page-header';
import { ProgressBar } from '@/components/common/progress';
import { SeverityBadge } from '@/components/common/status';
import { DeliveryTrendChart } from '@/components/common/trend-chart';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonKpis, SkeletonRows } from '@/components/ui/skeleton';
import { buildAttentionList, dayCompletionRatio } from '@/lib/engines/operational-attention';
import { formatElapsed, formatNumber, formatRelative, formatSmartDateTime } from '@/lib/format';
import { useLiveFleet, useSecondsSince } from '@/hooks/use-live-fleet';
import type { DashboardData } from '@/types/views';

/**
 * Panel operacional.
 *
 * Esta ordenado por la pregunta que trae el operador al abrir la aplicacion,
 * y no por la estructura de la base de datos:
 *
 *   1. ¿Por donde empiezo?      -> lo que requiere atencion, ya priorizado
 *   2. ¿Como va el dia?         -> el despacho como embudo, no como 7 cifras
 *   3. ¿Como esta la flota?     -> reparto real y quien esta en marcha
 *   4. ¿Que esta en ejecucion?  -> rutas y tendencia de la semana
 *   5. ¿Y la cartera?           -> estado comercial, que no es urgente
 *
 * La version anterior era una rejilla de veinte tarjetas con un numero cada
 * una. Tenia todos los datos y ninguna lectura: obligaba a comparar cifras
 * mentalmente para deducir donde estaba el problema. Las cifras siguen todas
 * aqui, pero cada una dentro de la pregunta que responde.
 */
export function DashboardView() {
  const { positions, lastUpdateAt } = useLiveFleet();
  const secondsSinceUpdate = useSecondsSince(lastUpdateAt);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<DashboardData> => {
      const response = await fetch('/api/dashboard');
      if (!response.ok) throw new Error('No fue posible cargar los indicadores.');
      return (await response.json()) as DashboardData;
    },
  });

  if (isError) {
    return (
      <>
        <PageHeader title="Panel operacional" />
        <QueryError
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Panel operacional" />
        <div className="space-y-4">
          <SkeletonKpis count={3} />
          <SkeletonRows rows={4} />
        </div>
      </>
    );
  }

  const { fleet, orders, clients, alerts, activeRoutes, recentAlerts, vehicles } = data;

  // La telemetria en vivo pisa a la instantanea del servidor: entre ambas
  // pueden pasar hasta 60 s y el operador vera la posicion mas reciente.
  const vehiclesLive = vehicles.map((snapshot) => {
    const live = positions.get(snapshot.vehicle.id);
    return live ? { ...snapshot, position: live } : snapshot;
  });

  const attention = buildAttentionList({
    fleet,
    orders,
    clients,
    alerts,
    activeRoutes,
    now: new Date(),
  });
  const completion = dayCompletionRatio(orders);

  const carteraTramos = [
    { id: 'activos', label: 'Activos', value: clients.activos.value, color: 'bg-status-active', href: '/clientes?estado=active' },
    { id: 'observacion', label: 'En observacion', value: clients.enObservacion.value, color: 'bg-status-warning', href: '/clientes?estado=warning' },
    { id: 'dormidos', label: 'Dormidos', value: clients.dormidos.value, color: 'bg-status-dormant', href: '/clientes/dormidos' },
  ];
  const carteraTotal = Math.max(1, clients.total.value);

  return (
    <>
      <PageHeader
        title="Panel operacional"
        description={
          <>
            Estado de la operacion al {formatSmartDateTime(data.generatedAt)}.{' '}
            <span className="text-ink-faint">
              Telemetria actualizada {formatElapsed(secondsSinceUpdate)}.
            </span>
          </>
        }
        actions={
          <LinkButton
            href="/control"
            variant="primary"
            size="sm"
            icon={<Radar className="h-3.5 w-3.5" />}
          >
            Abrir torre de control
          </LinkButton>
        }
      />

      <div className="space-y-5">
        {/* --- 1. Por donde empezar ------------------------------------- */}
        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            <AlertTriangle className="h-3.5 w-3.5" /> Requiere atencion
          </h2>
          <AttentionBoard items={attention} />
        </section>

        {/* --- 2 y 3. El dia y la flota --------------------------------- */}
        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
          <DayProgress orders={orders} completion={completion} />
          <FleetPulse fleet={fleet} vehicles={vehiclesLive} />
        </div>

        {/* --- 4. Lo que esta en ejecucion ------------------------------ */}
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader
              title="Rutas en curso"
              description={`${activeRoutes.length} rutas planificadas para hoy`}
              icon={<RouteIcon className="h-4 w-4" />}
              action={
                <Link
                  href="/rutas"
                  className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-brand-700 hover:underline sm:min-h-0 sm:px-0"
                >
                  Ver todas
                </Link>
              }
            />
            <CardBody className="p-0">
              {activeRoutes.length === 0 ? (
                <EmptyState
                  compact
                  icon={<RouteIcon className="h-5 w-5" />}
                  title="No hay rutas planificadas para hoy"
                  description="Cuando se asignen ordenes de trabajo a un vehiculo, la ruta aparecera aqui con su avance."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {activeRoutes.slice(0, 7).map((route) => (
                    <li key={route.routeId}>
                      <Link
                        prefetch={false}
                        href={`/rutas/${route.routeId}`}
                        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-800"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="numeric shrink-0 rounded bg-surface-750 px-1.5 py-0.5 text-2xs font-semibold text-brand-700">
                              {route.code}
                            </span>
                            <span className="truncate text-[13px] font-medium text-ink">
                              {route.name}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-2xs text-ink-faint">
                            {route.vehiclePlate ?? 'Sin vehiculo'}
                            {route.driverName ? ` · ${route.driverName}` : ''}
                            {route.nextStopName ? ` · Proxima: ${route.nextStopName}` : ''}
                          </p>
                        </div>

                        <div className="w-24 shrink-0 sm:w-32">
                          <ProgressBar
                            value={route.progressRatio}
                            size="sm"
                            tone={route.progressRatio === 1 ? 'active' : 'brand'}
                          />
                          <p className="numeric mt-1 text-right text-2xs text-ink-faint">
                            {route.completedStops}/{route.totalStops} entregas
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Entregas de la semana"
                description="Completadas e incidencias por dia"
                icon={<ClipboardList className="h-4 w-4" />}
              />
              <CardBody>
                <DeliveryTrendChart data={data.deliveryTrend} />
                <div className="mt-3 flex items-center gap-4 border-t border-line pt-3 text-2xs text-ink-faint">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-brand-500" /> Completadas
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-status-dormant" /> Incidencias
                  </span>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Alertas recientes"
                icon={<AlertTriangle className="h-4 w-4" />}
                action={
                  <Link
                    href="/alertas"
                    className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-brand-700 hover:underline sm:min-h-0 sm:px-0"
                  >
                    Centro de alertas
                  </Link>
                }
              />
              <CardBody className="p-0">
                {recentAlerts.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<AlertTriangle className="h-5 w-5" />}
                    title="Sin alertas abiertas"
                    description="La operacion se encuentra dentro de los parametros configurados."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {recentAlerts.slice(0, 5).map((alert) => (
                      <li key={alert.id}>
                        <Link
                          prefetch={false}
                          href={`/alertas?alerta=${encodeURIComponent(alert.id)}`}
                          className="block px-4 py-2.5 transition-colors hover:bg-surface-800"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="min-w-0 flex-1 truncate text-[13px] text-ink">
                              {alert.title}
                            </p>
                            <SeverityBadge severity={alert.severity} />
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-faint">
                            {alert.description}
                          </p>
                          <p className="mt-1 text-2xs text-ink-faint">
                            {formatRelative(alert.timestamp)}
                          </p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        {/* --- 5. Cartera comercial ------------------------------------- */}
        <Card>
          <CardHeader
            title="Cartera de clientes"
            description={`${formatNumber(clients.total.value)} clientes · ${formatNumber(clients.visitadosHoy.value)} visitados hoy`}
            icon={<Building2 className="h-4 w-4" />}
            action={
              <Link
                href="/clientes"
                className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-brand-700 hover:underline sm:min-h-0 sm:px-0"
              >
                Ver cartera
              </Link>
            }
          />
          <CardBody>
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-750">
              {carteraTramos
                .filter((t) => t.value > 0)
                .map((tramo) => (
                  <span
                    key={tramo.id}
                    className={tramo.color}
                    style={{ width: `${(tramo.value / carteraTotal) * 100}%` }}
                    title={`${tramo.label}: ${formatNumber(tramo.value)}`}
                  />
                ))}
            </div>

            <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              {carteraTramos.map((tramo) => (
                <li key={tramo.id}>
                  <Link
                    prefetch={false}
                    href={tramo.href}
                    className="group flex min-h-11 items-center gap-2 sm:min-h-0"
                  >
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${tramo.color}`} />
                    <span className="numeric text-sm font-semibold text-ink">
                      {formatNumber(tramo.value)}
                    </span>
                    <span className="text-xs text-ink-muted group-hover:text-ink">
                      {tramo.label}
                    </span>
                    {tramo.id === 'dormidos' && tramo.value > 0 ? (
                      <MoonStar className="h-3 w-3 text-status-dormant" />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {/* --- 6. Que incluye cada plan --------------------------------- */}
        <PlanOverview />
      </div>
    </>
  );
}
