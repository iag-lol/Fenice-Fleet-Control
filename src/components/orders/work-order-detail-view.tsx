'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, MapPin, Package, Route as RouteIcon, Share2, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DetailList } from '@/components/common/detail-list';
import { PageHeader } from '@/components/common/page-header';
import { RouteProgress } from '@/components/common/progress';
import {
  DeliveryConfirmationBadge,
  PRIORITY_LABEL,
  PriorityBadge,
  WorkOrderStatusBadge,
} from '@/components/common/status';
import { FleetMap } from '@/components/map/fleet-map';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { FeatureGate } from '@/components/product/feature-gate';
import { ProofCard } from '@/features/medium/evidence/proof-card';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { QueryError } from '@/components/ui/query-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import {
  formatCoordinates,
  formatCurrency,
  formatDistance,
  formatDuration,
  formatNumber,
  formatSmartDateTime,
  formatTime,
} from '@/lib/format';
import { useMapStore } from '@/stores/map-store';
import type { Client, DeliveryProof, Driver, Order, Route, Vehicle, WorkOrder } from '@/types/core';

interface WorkOrderDetailResponse {
  workOrder: WorkOrder;
  order: Order | null;
  client: Client | null;
  vehicle: Vehicle | null;
  driver: Driver | null;
  route: Route | null;
  /** Evidencia levantada por el conductor. `null` si aun no cerro la parada. */
  proof: DeliveryProof | null;
}

/** Ficha completa de una orden de trabajo, con trazabilidad GPS. */
export function WorkOrderDetailView({ workOrderId }: { workOrderId: string }) {
  const router = useRouter();
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);
  const highlightRoute = useMapStore((s) => s.highlightRoute);
  const [linkCopied, setLinkCopied] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['work-order', workOrderId],
    refetchInterval: 45_000,
    queryFn: async (): Promise<WorkOrderDetailResponse> => {
      const response = await fetch(`/api/ordenes/${workOrderId}`);
      if (response.status === 404) throw new Error('La orden de trabajo solicitada no existe.');
      if (!response.ok) throw new Error('No fue posible obtener la orden de trabajo.');
      return (await response.json()) as WorkOrderDetailResponse;
    },
  });

  if (isError) {
    return (
      <>
        <PageHeader
          title="Orden de trabajo"
          breadcrumb={
            <Link href="/ordenes" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft className="h-3 w-3" /> Volver a ordenes
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
        <PageHeader title="Orden de trabajo" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <SkeletonRows rows={7} />
        </div>
      </>
    );
  }

  const { workOrder, order, client, vehicle, driver, route } = data;

  const completedStops =
    route?.stops.filter((s) => ['visita_detectada', 'completada'].includes(s.status)).length ?? 0;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/ordenes" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Ordenes de trabajo
          </Link>
        }
        title={workOrder.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="numeric">Pedido {workOrder.orderNumber}</span>
            <WorkOrderStatusBadge status={workOrder.status} />
            <PriorityBadge priority={workOrder.priority} />
            <DeliveryConfirmationBadge source={workOrder.deliveryConfirmation} />
          </span>
        }
        actions={
          <>
            {workOrder.coordinates ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<MapPin className="h-3.5 w-3.5" />}
                onClick={() => {
                  select({ type: 'workOrder', id: workOrder.id });
                  focusOn(workOrder.coordinates!, 16);
                  router.push('/control');
                }}
              >
                Ver en mapa
              </Button>
            ) : null}

            <LinkButton
              href={`/seguimiento/${encodeURIComponent(workOrder.number)}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="secondary"
              size="sm"
              icon={<Share2 className="h-3.5 w-3.5" />}
            >
              Ver como el cliente
            </LinkButton>

            <Button
              variant="secondary"
              size="sm"
              icon={linkCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              onClick={() => {
                const link = `${window.location.origin}/seguimiento/${encodeURIComponent(workOrder.number)}`;
                void navigator.clipboard.writeText(link);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
            >
              {linkCopied ? 'Enlace copiado' : 'Copiar enlace para el cliente'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Entrega" description="Destino y ventana comprometida" />
            <CardBody>
              <DetailList
                items={[
                  {
                    label: 'Cliente',
                    value: client ? (
                      <Link href={`/clientes/${client.id}`} className="inline-flex min-h-11 items-center text-brand-700 hover:underline sm:min-h-0">
                        {client.tradeName}
                      </Link>
                    ) : (
                      workOrder.clientName
                    ),
                  },
                  { label: 'Codigo cliente', value: <span className="numeric">{client?.code ?? '--'}</span> },
                  {
                    label: 'Direccion',
                    value: `${workOrder.addressLine}, ${workOrder.communeName}`,
                    full: true,
                  },
                  {
                    label: 'Coordenadas',
                    value: workOrder.coordinates ? (
                      <span className="numeric text-xs">
                        {formatCoordinates(workOrder.coordinates.lat, workOrder.coordinates.lng)}
                      </span>
                    ) : (
                      <span className="text-status-warning">
                        Sin coordenadas: la direccion no pudo geolocalizarse.
                      </span>
                    ),
                    full: true,
                  },
                  { label: 'Fecha programada', value: formatSmartDateTime(workOrder.scheduledDate) },
                  { label: 'Prioridad', value: PRIORITY_LABEL[workOrder.priority] },
                  {
                    label: 'Ventana comprometida',
                    value: `${formatTime(workOrder.scheduledWindowStart)} - ${formatTime(workOrder.scheduledWindowEnd)}`,
                  },
                  {
                    label: 'Hora estimada',
                    value: <span className="numeric">{formatTime(workOrder.estimatedArrivalAt)}</span>,
                  },
                  {
                    label: 'Observaciones',
                    value: workOrder.notes ?? 'Sin observaciones',
                    full: true,
                  },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Trazabilidad GPS"
              description="Evidencia registrada por geocerca de entrega"
            />
            <CardBody>
              {workOrder.actualArrivalAt ? (
                <DetailList
                  items={[
                    {
                      label: 'Hora de entrada',
                      value: <span className="numeric text-status-active">{formatTime(workOrder.actualArrivalAt)}</span>,
                    },
                    {
                      label: 'Hora de salida',
                      value: (
                        <span className="numeric">
                          {workOrder.actualDepartureAt ? formatTime(workOrder.actualDepartureAt) : 'En el domicilio'}
                        </span>
                      ),
                    },
                    {
                      label: 'Permanencia',
                      value: <span className="numeric">{formatDuration(workOrder.dwellSeconds)}</span>,
                    },
                    {
                      label: 'Distancia minima al domicilio',
                      value: <span className="numeric">{formatDistance(workOrder.closestApproachMeters)}</span>,
                    },
                    {
                      label: 'Confirmacion',
                      value:
                        workOrder.deliveryConfirmation === 'gps'
                          ? 'Entrega detectada automaticamente por GPS'
                          : workOrder.deliveryConfirmation === 'driver'
                            ? 'Entrega firmada por el conductor en terreno'
                            : workOrder.deliveryConfirmation === 'admin'
                              ? 'Entrega confirmada por administracion'
                              : workOrder.deliveryConfirmation === 'manual'
                                ? 'Entrega confirmada manualmente por el operador'
                                : 'Visita registrada, entrega no confirmada',
                      full: true,
                    },
                  ]}
                />
              ) : (
                <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
                  Todavia no se registra el ingreso del vehiculo a la geocerca de este cliente. La
                  evidencia aparecera automaticamente cuando el camion entre al perimetro.
                </p>
              )}
            </CardBody>
          </Card>

          <FeatureGate featureId="proof-of-delivery">
            <Card>
              <CardHeader
                title="Evidencia de terreno"
                description="Lo declarado por el conductor al cerrar la parada"
              />
              <CardBody>
                {data.proof ? (
                  <ProofCard proof={data.proof} />
                ) : (
                  <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
                    El conductor todavia no cierra esta parada desde su portal. La evidencia
                    aparece aqui en cuanto la declara, incluso si la registro sin conexion.
                  </p>
                )}
              </CardBody>
            </Card>
          </FeatureGate>

          {order ? (
            <Card>
              <CardHeader
                title="Detalle del pedido"
                description={`${formatNumber(order.totalLiters)} L · ${formatNumber(order.totalWeightKg)} kg de carga`}
                icon={<Package className="h-4 w-4" />}
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-line">
                  {order.lines.map((line) => (
                    <li key={line.sku} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-ink">{line.description}</p>
                        <p className="numeric truncate text-2xs text-ink-faint">
                          {formatNumber(line.liters)} L · {formatCurrency(line.pricePerLiter)}/L
                          {line.compartment !== null ? ` · compartimento ${line.compartment}` : ''}
                        </p>
                        <p className="truncate text-2xs text-ink-faint">{line.hazardClass}</p>
                      </div>
                      <span className="numeric shrink-0 text-[13px] text-ink-muted">
                        {formatCurrency(line.liters * line.pricePerLiter)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
                  <span className="text-2xs uppercase tracking-wider text-ink-faint">Total</span>
                  <span className="numeric text-sm font-semibold text-ink">
                    {formatCurrency(order.totalAmount)}
                  </span>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Asignacion" description="Vehiculo, conductor y ruta" icon={<Truck className="h-4 w-4" />} />
            <CardBody className="space-y-3">
              {vehicle ? (
                <DetailList
                  items={[
                    {
                      label: 'Camion',
                      value: (
                        <Link href={`/flota/${vehicle.id}`} className="inline-flex min-h-11 items-center text-brand-700 hover:underline sm:min-h-0">
                          {vehicle.plate} · {vehicle.fleetCode}
                        </Link>
                      ),
                    },
                    { label: 'Conductor', value: driver?.fullName ?? 'Sin conductor' },
                    { label: 'Telefono conductor', value: driver ? <span className="numeric">{driver.phone}</span> : '--' },
                    { label: 'Base', value: vehicle.depotName },
                  ]}
                />
              ) : (
                <p className="rounded-md border border-status-warning/25 bg-status-warning/5 px-3 py-2.5 text-xs text-ink">
                  Esta orden de trabajo no tiene camion asignado. Aparece en el centro de alertas como
                  <span className="font-medium"> OT sin camion</span>.
                </p>
              )}

              {route ? (
                <div className="rounded-md border border-line bg-surface-800 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-2xs uppercase tracking-wider text-ink-faint">Ruta asignada</p>
                      <Link
                        href={`/rutas/${route.id}`}
                        className="mt-0.5 flex min-h-11 items-center truncate text-[13px] font-medium text-brand-700 hover:underline sm:mt-0.5 sm:block sm:min-h-0"
                      >
                        {route.code} · {route.name}
                      </Link>
                    </div>
                    <span className="numeric shrink-0 rounded bg-surface-750 px-1.5 py-0.5 text-2xs text-ink-muted">
                      Parada {workOrder.stopSequence ?? '--'}
                    </span>
                  </div>

                  <RouteProgress
                    className="mt-3"
                    completed={completedStops}
                    total={route.stops.length}
                  />

                  <Button
                    className="mt-3"
                    size="sm"
                    variant="secondary"
                    block
                    icon={<RouteIcon className="h-3.5 w-3.5" />}
                    onClick={() => {
                      highlightRoute(route.id);
                      router.push('/control');
                    }}
                  >
                    Resaltar ruta en el mapa
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {workOrder.coordinates ? (
            <Card className="overflow-hidden">
              <CardHeader title="Destino" description={workOrder.addressLine} />
              <div className="relative h-[300px]">
                <ErrorBoundary section="el mapa de la orden">
                  <FleetMap
                    className="absolute inset-0"
                    layerOverride={{ clientes: true, camiones: false, rutas: false, geocercas: false, calor: false, pedidos: false, alertas: false, comunas: false }}
                    vehicles={[]}
                    clients={[
                      {
                        clientId: workOrder.clientId,
                        code: client?.code ?? '',
                        name: workOrder.clientName,
                        lat: workOrder.coordinates.lat,
                        lng: workOrder.coordinates.lng,
                        communeCode: workOrder.communeCode,
                        communeName: workOrder.communeName,
                        addressLine: workOrder.addressLine,
                        status: 'active',
                        daysSincePurchase: null,
                        daysSinceVisit: null,
                        hasPendingOrder: true,
                        visitedToday: workOrder.actualArrivalAt !== null,
                        lifetimeValue: 0,
                        segment: client?.segment ?? 'estacion_servicio',
                        salesRep: client?.salesRep ?? null,
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
        </div>
      </div>
    </>
  );
}
