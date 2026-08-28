'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Package, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { DetailList } from '@/components/common/detail-list';
import { Stat } from '@/components/common/kpi';
import { PageHeader } from '@/components/common/page-header';
import { ClientStatusBadge, WorkOrderStatusBadge } from '@/components/common/status';
import { FleetMap } from '@/components/map/fleet-map';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PendingIntegrationNotice, QueryError } from '@/components/ui/query-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import {
  formatCurrency,
  formatDays,
  formatDistance,
  formatDuration,
  formatNumber,
  formatSmartDateTime,
} from '@/lib/format';
import { useMapStore } from '@/stores/map-store';
import type { ClientDetail } from '@/types/views';

/** Ficha completa del cliente: datos, estado comercial, pedidos y visitas. */
export function ClientDetailView({ clientId }: { clientId: string }) {
  const router = useRouter();
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async (): Promise<ClientDetail> => {
      const response = await fetch(`/api/clients/${clientId}`);
      if (response.status === 404) throw new Error('El cliente solicitado no existe.');
      if (!response.ok) throw new Error('No fue posible obtener el detalle del cliente.');
      return (await response.json()) as ClientDetail;
    },
  });

  if (isError) {
    return (
      <>
        <PageHeader
          title="Detalle de cliente"
          breadcrumb={
            <Link href="/clientes" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft className="h-3 w-3" /> Volver a clientes
            </Link>
          }
        />
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
        <PageHeader title="Detalle de cliente" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <SkeletonRows rows={6} />
        </div>
      </>
    );
  }

  const { snapshot, recentOrders, workOrders, visits, totals } = data;
  const { client, primaryLocation } = snapshot;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/clientes" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Clientes
          </Link>
        }
        title={client.tradeName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="numeric">{client.code}</span>
            <span className="text-ink-faint">·</span>
            <span>{client.legalName}</span>
            <ClientStatusBadge status={snapshot.activityStatus} />
          </span>
        }
        actions={
          primaryLocation?.coordinates ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<MapPin className="h-3.5 w-3.5" />}
              onClick={() => {
                select({ type: 'client', id: clientId });
                focusOn(primaryLocation.coordinates!, 16);
                router.push('/control');
              }}
            >
              Ver en mapa operacional
            </Button>
          ) : null
        }
      />

      <div className="space-y-4">
        <Card>
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Dias sin comprar" value={formatDays(snapshot.daysSincePurchase)} tone={snapshot.activityStatus === 'dormant' ? 'danger' : snapshot.activityStatus === 'warning' ? 'warning' : 'active'} />
            <Stat label="Dias sin visita" value={formatDays(snapshot.daysSinceVisit)} />
            <Stat label="Pedidos historicos" value={formatNumber(client.totalOrders)} />
            <Stat label="Entregas OK" value={formatNumber(totals.delivered)} tone="active" />
            <Stat label="Incidencias" value={formatNumber(totals.incidents)} tone={totals.incidents > 0 ? 'danger' : 'neutral'} />
            <Stat label="Valor acumulado" value={formatCurrency(client.lifetimeValue)} />
          </CardBody>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Datos comerciales" />
              <CardBody>
                <DetailList
                  items={[
                    { label: 'RUT', value: <span className="numeric">{client.taxId}</span> },
                    { label: 'Segmento', value: <span className="capitalize">{client.segment}</span> },
                    { label: 'Contacto', value: client.contactName ?? 'Sin contacto' },
                    { label: 'Telefono', value: client.phone ? <span className="numeric">{client.phone}</span> : 'Sin telefono' },
                    { label: 'Correo', value: client.email ?? 'Sin correo', full: true },
                    { label: 'Vendedor asignado', value: client.salesRep ?? 'Sin asignar' },
                    { label: 'Cliente desde', value: formatSmartDateTime(client.createdAt) },
                    { label: 'Ultima compra', value: formatSmartDateTime(client.lastPurchaseAt) },
                    { label: 'Ultima visita', value: formatSmartDateTime(client.lastVisitAt) },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Direcciones de despacho"
                description={`${client.locations.length} direccion(es) registradas`}
              />
              <CardBody className="p-0">
                {client.locations.some((l) => !l.coordinates) ? (
                  <div className="border-b border-line p-3">
                    <PendingIntegrationNotice what="La resolucion automatica de direcciones a coordenadas requiere configurar GEOCODING_PROVIDER. Mientras tanto, estas direcciones se reportan como alerta operacional." />
                  </div>
                ) : null}

                <ul className="divide-y divide-line">
                  {client.locations.map((location) => (
                    <li key={location.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-ink">{location.label}</p>
                          <p className="truncate text-2xs text-ink-faint">
                            {location.addressLine}, {location.communeName}
                          </p>
                        </div>
                        {location.isPrimary ? (
                          <span className="shrink-0 rounded bg-brand-500/15 px-1.5 py-0.5 text-2xs text-brand-700">
                            Principal
                          </span>
                        ) : null}
                      </div>

                      {location.coordinates ? (
                        <p className="numeric mt-1 text-2xs text-ink-faint">
                          Geocerca de entrega: {location.deliveryRadiusMeters ?? 80} m de radio
                        </p>
                      ) : (
                        <p className="mt-1 text-2xs text-status-warning">
                          Sin coordenadas: no puede geocercarse ni mostrarse en el mapa.
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            {primaryLocation?.coordinates ? (
              <Card className="overflow-hidden">
                <CardHeader title="Ubicacion" description={primaryLocation.addressLine} />
                <div className="relative h-[260px]">
                  <ErrorBoundary section="el mapa del cliente">
                    <FleetMap
                      className="absolute inset-0"
                    layerOverride={{ clientes: true, camiones: false, rutas: false, geocercas: false, calor: false, pedidos: false, alertas: false, comunas: false }}
                      vehicles={[]}
                      clients={[
                        {
                          clientId,
                          code: client.code,
                          name: client.tradeName,
                          lat: primaryLocation.coordinates.lat,
                          lng: primaryLocation.coordinates.lng,
                          communeCode: primaryLocation.communeCode,
                          communeName: primaryLocation.communeName,
                          addressLine: primaryLocation.addressLine,
                          status: snapshot.activityStatus,
                          daysSincePurchase: snapshot.daysSincePurchase,
                          daysSinceVisit: snapshot.daysSinceVisit,
                          hasPendingOrder: snapshot.hasPendingOrder,
                          visitedToday: snapshot.visitedToday,
                          lifetimeValue: client.lifetimeValue,
                          segment: client.segment,
                          salesRep: client.salesRep,
                        },
                      ]}
                      routes={[]}
                      geofences={[]}
                      alerts={[]}
                      workOrders={[]}
                      communes={[]}
                      heatmapPoints={[]}
                    />
                  </ErrorBoundary>
                </div>
              </Card>
            ) : null}

            <Card id="historial">
              <CardHeader
                title="Ordenes de trabajo"
                description="Despachos asociados a este cliente"
                icon={<Package className="h-4 w-4" />}
              />
              <CardBody className="p-0">
                {workOrders.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Package className="h-5 w-5" />}
                    title="Sin ordenes registradas"
                    description="Este cliente no tiene ordenes de trabajo en la ventana disponible."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {workOrders.slice(0, 8).map((workOrder) => (
                      <li key={workOrder.id}>
                        <Link
                          prefetch={false}
                          href={`/ordenes/${workOrder.id}`}
                          className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-800"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="numeric truncate text-[13px] font-medium text-brand-700">
                              {workOrder.number}
                            </p>
                            <p className="truncate text-2xs text-ink-faint">
                              {formatSmartDateTime(workOrder.scheduledDate)} · Pedido{' '}
                              {workOrder.orderNumber}
                            </p>
                          </div>
                          <WorkOrderStatusBadge status={workOrder.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Visitas detectadas por GPS"
                description="Evidencia de paso por el domicilio"
                icon={<Truck className="h-4 w-4" />}
              />
              <CardBody className="p-0">
                {visits.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Truck className="h-5 w-5" />}
                    title="Sin visitas registradas"
                    description="Todavia no se ha detectado el ingreso de un vehiculo a la geocerca de este cliente."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {visits.slice(0, 8).map((visit) => (
                      <li key={visit.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-ink">
                            {formatSmartDateTime(visit.date)}
                          </p>
                          <p className="numeric truncate text-2xs text-ink-faint">
                            {visit.vehiclePlate ?? 'Vehiculo desconocido'} ·{' '}
                            {formatDistance(visit.distanceMeters)} del domicilio
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="numeric text-2xs text-ink-muted">
                            {formatDuration(visit.dwellSeconds)}
                          </p>
                          <p
                            className={
                              visit.confirmed
                                ? 'text-2xs text-status-active'
                                : 'text-2xs text-ink-faint'
                            }
                          >
                            {visit.confirmed ? 'Visita confirmada' : 'Paso sin permanencia'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Ultimos pedidos" description="Historial comercial" />
              <CardBody className="p-0">
                {recentOrders.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<Package className="h-5 w-5" />}
                    title="Sin pedidos en el historial"
                    description="No hay pedidos registrados para este cliente en la fuente de datos actual."
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {recentOrders.slice(0, 8).map((order) => (
                      <li
                        key={order.id}
                        className="flex items-center justify-between gap-3 px-4 py-2.5"
                      >
                        <div className="min-w-0">
                          <p className="numeric truncate text-[13px] text-ink">{order.number}</p>
                          <p className="truncate text-2xs text-ink-faint">
                            {formatSmartDateTime(order.createdAt)} · {order.lines.length} linea(s)
                          </p>
                        </div>
                        <span className="numeric shrink-0 text-[13px] text-ink-muted">
                          {formatCurrency(order.totalAmount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
