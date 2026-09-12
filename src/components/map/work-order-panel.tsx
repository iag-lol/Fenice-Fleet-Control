'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  DeliveryConfirmationBadge,
  PriorityBadge,
  WorkOrderStatusBadge,
} from '@/components/common/status';
import { Button } from '@/components/ui/button';
import { formatDistance, formatSmartDateTime } from '@/lib/format';
import { isUsableCoordinate } from '@/lib/geo';
import { useMapStore } from '@/stores/map-store';
import type { Client, Driver, Order, Route, Vehicle, WorkOrder } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

interface WorkOrderResponse {
  workOrder: WorkOrder;
  order: Order | null;
  client: Client | null;
  vehicle: Vehicle | null;
  driver: Driver | null;
  route: Route | null;
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-xs text-ink">{value}</dd>
    </div>
  );
}

/** Operational context in-place; the full order page remains available for evidence and editing. */
export function WorkOrderPanel({
  workOrderId,
  snapshot,
}: {
  workOrderId: string;
  snapshot: MapSnapshot | null;
}) {
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['work-order', workOrderId],
    queryFn: async (): Promise<WorkOrderResponse> => {
      const response = await fetch(`/api/ordenes/${encodeURIComponent(workOrderId)}`);
      if (!response.ok)
        throw new Error(
          response.status === 404
            ? 'La orden ya no está disponible.'
            : 'No fue posible cargar el detalle del despacho.',
        );
      return response.json() as Promise<WorkOrderResponse>;
    },
    refetchInterval: 45_000,
  });
  const select = useMapStore((s) => s.select);
  const focusOn = useMapStore((s) => s.focusOn);
  const fitPoints = useMapStore((s) => s.fitPoints);
  const workOrder = data?.workOrder;
  const point =
    workOrder?.coordinates ??
    snapshot?.pendingWorkOrders.find((w) => w.workOrderId === workOrderId) ??
    null;

  if (isLoading && !data)
    return (
      <p role="status" className="p-4 text-xs text-ink-faint">
        Cargando despacho…
      </p>
    );
  if (error && !data)
    return (
      <div className="space-y-3 p-4">
        <p role="alert" className="text-xs text-status-dormant">
          {error.message}
        </p>
        <Button variant="secondary" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </div>
    );
  if (!workOrder)
    return <p className="p-4 text-xs text-ink-faint">La orden ya no está disponible.</p>;

  const route = snapshot?.routes.find((r) => r.routeId === workOrder.routeId);
  const shownRoute = route ?? data.route;
  const vehicle =
    data.vehicle ?? snapshot?.vehicles.find((v) => v.vehicle.id === workOrder.vehicleId)?.vehicle;
  const stop = route?.stops.find((s) => s.workOrderId === workOrderId);
  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex flex-wrap gap-2">
          <WorkOrderStatusBadge status={workOrder.status} />
          <PriorityBadge priority={workOrder.priority} />
        </div>
        <h3 className="mt-2 text-base font-semibold text-ink">{workOrder.number}</h3>
        <p className="mt-1 text-sm text-ink-muted">{workOrder.clientName}</p>
        <p className="text-xs text-ink-faint">
          {workOrder.addressLine}, {workOrder.communeName}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 rounded-md border border-line p-3">
        <Detail label="Pedido" value={workOrder.orderNumber} />
        <Detail label="Fecha programada" value={formatSmartDateTime(workOrder.scheduledDate)} />
        <Detail
          label="Ventana comprometida"
          value={
            workOrder.scheduledWindowStart && workOrder.scheduledWindowEnd
              ? `${formatSmartDateTime(workOrder.scheduledWindowStart)} – ${formatSmartDateTime(workOrder.scheduledWindowEnd)}`
              : 'Sin ventana'
          }
        />
        <Detail
          label="ETA"
          value={
            workOrder.estimatedArrivalAt
              ? formatSmartDateTime(workOrder.estimatedArrivalAt)
              : 'Sin estimación'
          }
        />
        <Detail label="Vehículo" value={vehicle?.plate ?? 'Sin asignar'} />
        <Detail label="Conductor" value={data.driver?.fullName ?? 'Sin asignar'} />
        <Detail
          label="Ruta / parada"
          value={
            shownRoute
              ? `${'code' in shownRoute ? shownRoute.code : ''} · ${workOrder.stopSequence ?? stop?.sequence ?? '—'}`
              : 'Sin ruta'
          }
        />
        <Detail
          label="Confirmación"
          value={<DeliveryConfirmationBadge source={workOrder.deliveryConfirmation} />}
        />
        {workOrder.actualArrivalAt ? (
          <Detail label="Llegada real" value={formatSmartDateTime(workOrder.actualArrivalAt)} />
        ) : null}
        {workOrder.closestApproachMeters !== null ? (
          <Detail
            label="Distancia mínima"
            value={formatDistance(workOrder.closestApproachMeters)}
          />
        ) : null}
        {workOrder.dwellSeconds !== null ? (
          <Detail label="Permanencia" value={`${Math.round(workOrder.dwellSeconds / 60)} min`} />
        ) : null}
      </dl>
      {workOrder.notes ? (
        <div>
          <h4 className="text-xs font-semibold text-ink">Notas</h4>
          <p className="mt-1 text-xs text-ink-muted">{workOrder.notes}</p>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!point || !isUsableCoordinate(point)}
          onClick={() => {
            if (point) focusOn(point, 16);
          }}
        >
          Centrar entrega
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!route}
          onClick={() => {
            if (route) {
              select({ type: 'route', id: route.routeId });
              fitPoints([...route.plannedPath, ...route.stops]);
            }
          }}
        >
          Ver ruta
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!workOrder.clientId}
          onClick={() => select({ type: 'client', id: workOrder.clientId })}
        >
          Ver cliente
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!workOrder.vehicleId}
          onClick={() => {
            if (workOrder.vehicleId) select({ type: 'vehicle', id: workOrder.vehicleId });
          }}
        >
          Ver vehículo
        </Button>
      </div>
      <Link
        href={`/ordenes/${encodeURIComponent(workOrderId)}`}
        className="flex min-h-11 items-center justify-center rounded-md border border-line-strong px-3 text-xs font-medium text-brand-700 hover:bg-surface-800"
      >
        Abrir orden completa y evidencia
      </Link>
    </div>
  );
}
