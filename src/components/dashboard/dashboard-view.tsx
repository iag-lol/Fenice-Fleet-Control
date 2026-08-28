'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  ExternalLink,
  MapPin,
  MoonStar,
  Package,
  Route as RouteIcon,
  Truck,
  WifiOff,
} from 'lucide-react';
import Link from 'next/link';

import { KpiCard, KpiGrid } from '@/components/common/kpi';
import { PageHeader } from '@/components/common/page-header';
import { ProgressBar } from '@/components/common/progress';
import { SeverityBadge, VehicleStatusBadge } from '@/components/common/status';
import { DeliveryTrendChart } from '@/components/common/trend-chart';
import { LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonKpis, SkeletonRows } from '@/components/ui/skeleton';
import { formatElapsed, formatRelative, formatSmartDateTime, formatSpeed } from '@/lib/format';
import { useLiveFleet, useSecondsSince } from '@/hooks/use-live-fleet';
import type { DashboardData } from '@/types/views';

/**
 * Panel principal. Responde de un vistazo: como esta la flota ahora, como va
 * el despacho del dia, en que estado esta la cartera y que requiere atencion.
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
          <SkeletonKpis count={5} />
          <SkeletonKpis count={4} />
          <SkeletonRows rows={4} />
        </div>
      </>
    );
  }

  const { fleet, orders, clients, alerts, activeRoutes, recentAlerts, vehicles } = data;

  const offlineVehicles = vehicles.filter((v) => v.status === 'offline');
  const movingVehicles = vehicles
    .filter((v) => v.status === 'en_ruta')
    .sort((a, b) => (b.position?.speed ?? 0) - (a.position?.speed ?? 0));

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
            href="/mapa"
            variant="secondary"
            size="sm"
            icon={<MapPin className="h-3.5 w-3.5" />}
          >
            Abrir mapa operacional
          </LinkButton>
        }
      />

      <div className="space-y-5">
        {/* --- Flota --- */}
        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            <Truck className="h-3.5 w-3.5" /> Flota
          </h2>
          <KpiGrid className="lg:grid-cols-5">
            <KpiCard label="Vehiculos totales" kpi={fleet.total} href="/flota" />
            <KpiCard label="En ruta" kpi={fleet.enRuta} tone="brand" href="/flota?estado=en_ruta" />
            <KpiCard label="Detenidos" kpi={fleet.detenidos} tone="warning" href="/flota?estado=detenido" />
            <KpiCard
              label="Offline"
              kpi={fleet.offline}
              tone={fleet.offline.value > 0 ? 'danger' : 'neutral'}
              href="/flota?estado=offline"
            />
            <KpiCard
              label="Con alertas"
              kpi={fleet.conAlertas}
              tone={fleet.conAlertas.value > 0 ? 'warning' : 'neutral'}
              href="/alertas"
            />
          </KpiGrid>
        </section>

        {/* --- Pedidos --- */}
        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            <Package className="h-3.5 w-3.5" /> Despachos de hoy
          </h2>
          <KpiGrid className="lg:grid-cols-4 xl:grid-cols-7">
            <KpiCard label="Despachos hoy" kpi={orders.despachosHoy} href="/ordenes" />
            <KpiCard label="Pendientes" kpi={orders.pendientes} tone="warning" href="/ordenes?estado=pendiente" />
            <KpiCard label="En ruta" kpi={orders.enRuta} tone="brand" href="/ordenes?estado=en_ruta" />
            <KpiCard label="Proximas" kpi={orders.proximasEntregas} tone="warning" href="/ordenes?estado=proxima" />
            <KpiCard label="Visitados" kpi={orders.visitados} tone="active" href="/ordenes?estado=visita_detectada" />
            <KpiCard label="Finalizados" kpi={orders.finalizados} tone="active" href="/ordenes?estado=completada" />
            <KpiCard
              label="Con incidencia"
              kpi={orders.conIncidencia}
              tone={orders.conIncidencia.value > 0 ? 'danger' : 'neutral'}
              href="/ordenes?estado=incidencia"
            />
          </KpiGrid>
        </section>

        {/* --- Clientes y alertas --- */}
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <section>
            <h2 className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              <Building2 className="h-3.5 w-3.5" /> Cartera de clientes
            </h2>
            <KpiGrid className="lg:grid-cols-5">
              <KpiCard label="Total clientes" kpi={clients.total} href="/clientes" />
              <KpiCard label="Activos" kpi={clients.activos} tone="active" href="/clientes?estado=active" />
              <KpiCard
                label="En observacion"
                kpi={clients.enObservacion}
                tone="warning"
                href="/clientes?estado=warning"
              />
              <KpiCard
                label="Dormidos"
                kpi={clients.dormidos}
                tone="danger"
                href="/clientes/dormidos"
                icon={<MoonStar className="h-3.5 w-3.5" />}
              />
              <KpiCard label="Visitados hoy" kpi={clients.visitadosHoy} tone="brand" />
            </KpiGrid>
          </section>

          <section>
            <h2 className="mb-2.5 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              <AlertTriangle className="h-3.5 w-3.5" /> Alertas abiertas
            </h2>
            <KpiGrid className="grid-cols-3 lg:grid-cols-3">
              <KpiCard
                label="Criticas"
                kpi={alerts.criticas}
                tone={alerts.criticas.value > 0 ? 'danger' : 'neutral'}
                href="/alertas?severidad=critical"
              />
              <KpiCard
                label="Advertencias"
                kpi={alerts.advertencias}
                tone={alerts.advertencias.value > 0 ? 'warning' : 'neutral'}
                href="/alertas?severidad=warning"
              />
              <KpiCard label="Informativas" kpi={alerts.informativas} href="/alertas?severidad=info" />
            </KpiGrid>
          </section>
        </div>

        {/* --- Rutas, tendencia y alertas recientes --- */}
        <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
          <Card>
            <CardHeader
              title="Rutas en curso"
              description={`${activeRoutes.length} rutas planificadas para hoy`}
              icon={<RouteIcon className="h-4 w-4" />}
              action={
                <Link href="/rutas" className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-brand-700 hover:underline sm:min-h-0 sm:px-0">
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
                  {activeRoutes.slice(0, 6).map((route) => (
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
                            <span className="truncate text-[13px] font-medium text-ink">{route.name}</span>
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
                  <Link href="/alertas" className="inline-flex min-h-11 items-center px-1 text-xs font-medium text-brand-700 hover:underline sm:min-h-0 sm:px-0">
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
                            <p className="min-w-0 flex-1 truncate text-[13px] text-ink">{alert.title}</p>
                            <SeverityBadge severity={alert.severity} />
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-faint">
                            {alert.description}
                          </p>
                          <p className="mt-1 text-2xs text-ink-faint">{formatRelative(alert.timestamp)}</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        {/* --- Vehiculos en movimiento y sin senal --- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Vehiculos en movimiento"
              description="Telemetria en vivo"
              icon={<Truck className="h-4 w-4" />}
            />
            <CardBody className="p-0">
              {movingVehicles.length === 0 ? (
                <EmptyState
                  compact
                  icon={<Truck className="h-5 w-5" />}
                  title="Ningun vehiculo en movimiento"
                  description="Todos los vehiculos con telemetria estan detenidos o fuera de servicio en este momento."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {movingVehicles.slice(0, 6).map((snapshot) => {
                    const live = positions.get(snapshot.vehicle.id) ?? snapshot.position;

                    return (
                      <li key={snapshot.vehicle.id}>
                        <Link
                          prefetch={false}
                          href={`/flota/${snapshot.vehicle.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-800"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-ink">
                              {snapshot.vehicle.plate}
                              <span className="ml-2 text-2xs font-normal text-ink-faint">
                                {snapshot.vehicle.fleetCode}
                              </span>
                            </p>
                            <p className="truncate text-2xs text-ink-faint">
                              {snapshot.driver?.fullName ?? 'Sin conductor asignado'}
                            </p>
                          </div>
                          <span className="numeric shrink-0 text-xs text-brand-700">
                            {formatSpeed(live?.speed ?? null)}
                          </span>
                          <VehicleStatusBadge status={snapshot.status} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Sin senal GPS"
              description="Requieren revision del equipo"
              icon={<WifiOff className="h-4 w-4" />}
            />
            <CardBody className="p-0">
              {offlineVehicles.length === 0 ? (
                <EmptyState
                  compact
                  icon={<WifiOff className="h-5 w-5" />}
                  title="Toda la flota esta reportando"
                  description="Ningun equipo supera el umbral de perdida de senal configurado."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {offlineVehicles.map((snapshot) => (
                    <li key={snapshot.vehicle.id}>
                      <Link
                        prefetch={false}
                        href={`/flota/${snapshot.vehicle.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-800"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-medium text-ink">
                            {snapshot.vehicle.plate}
                            <span className="ml-2 text-2xs font-normal text-ink-faint">
                              {snapshot.vehicle.fleetCode}
                            </span>
                          </p>
                          <p className="truncate text-2xs text-ink-faint">
                            {snapshot.device
                              ? `Ultima posicion ${formatElapsed(snapshot.device.secondsSinceLastPosition)}`
                              : 'Vehiculo sin equipo GPS instalado'}
                          </p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
