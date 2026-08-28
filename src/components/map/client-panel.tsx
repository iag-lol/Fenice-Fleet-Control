'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  Crosshair,
  ExternalLink,
  History,
  MapPin,
  Package,
  Phone,
  Route as RouteIcon,
  Truck,
  User,
} from 'lucide-react';
import Link from 'next/link';

import { DetailList, Section } from '@/components/common/detail-list';
import { ClientStatusBadge, WorkOrderStatusBadge } from '@/components/common/status';
import { Button, LinkButton } from '@/components/ui/button';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import {
  formatCurrency,
  formatDays,
  formatDistance,
  formatDuration,
  formatSmartDateTime,
} from '@/lib/format';
import { useMapStore } from '@/stores/map-store';
import type { ClientDetail } from '@/types/views';

/**
 * Ficha comercial del cliente.
 *
 * Panel completo, no un globo diminuto: la decision comercial requiere estado,
 * antiguedad, pedidos activos, proxima entrega y evidencia de visitas.
 */
export function ClientPanel({ clientId }: { clientId: string }) {
  const focusOn = useMapStore((s) => s.focusOn);
  const highlightRoute = useMapStore((s) => s.highlightRoute);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async (): Promise<ClientDetail> => {
      const response = await fetch(`/api/clients/${clientId}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No fue posible obtener el detalle del cliente.');
      }
      return (await response.json()) as ClientDetail;
    },
  });

  if (isError) {
    return (
      <div className="p-4">
        <QueryError
          title="No fue posible cargar el cliente"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-4">
        <SkeletonRows rows={6} />
      </div>
    );
  }

  const { snapshot, activeWorkOrder, nextWorkOrder, visits, totals } = data;
  const { client, primaryLocation } = snapshot;

  return (
    <div className="space-y-5 p-4 pb-6">
      {/* --- Encabezado --- */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold tracking-tight text-ink">
            {client.tradeName}
          </h3>
          <p className="mt-0.5 truncate text-xs text-ink-faint">
            <span className="numeric">{client.code}</span> · {client.legalName}
          </p>
        </div>
        <ClientStatusBadge status={snapshot.activityStatus} size="md" />
      </div>

      {/* --- Acciones --- */}
      <div className="grid grid-cols-2 gap-2">
        <LinkButton
          href={`/clientes/${clientId}`}
          variant="secondary"
          size="sm"
          icon={<ExternalLink className="h-3.5 w-3.5" />}
        >
          Ver detalle
        </LinkButton>

        <LinkButton
          href={`/ordenes?cliente=${encodeURIComponent(clientId)}`}
          variant="secondary"
          size="sm"
          icon={<Package className="h-3.5 w-3.5" />}
        >
          Ver pedidos
        </LinkButton>

        <LinkButton
          href={`/clientes/${clientId}#historial`}
          variant="secondary"
          size="sm"
          icon={<History className="h-3.5 w-3.5" />}
        >
          Ver historial
        </LinkButton>

        <Button
          variant="secondary"
          size="sm"
          icon={<Crosshair className="h-3.5 w-3.5" />}
          onClick={() => primaryLocation?.coordinates && focusOn(primaryLocation.coordinates, 16)}
          disabled={!primaryLocation?.coordinates}
        >
          Centrar mapa
        </Button>

        {activeWorkOrder?.routeId ? (
          <Button
            variant="secondary"
            size="sm"
            className="col-span-2"
            icon={<RouteIcon className="h-3.5 w-3.5" />}
            onClick={() => highlightRoute(activeWorkOrder.routeId)}
          >
            Mostrar ruta relacionada
          </Button>
        ) : null}
      </div>

      {/* --- Ficha --- */}
      <Section title="Datos del cliente">
        <DetailList
          items={[
            { label: 'RUT', value: <span className="numeric">{client.taxId}</span> },
            { label: 'Segmento', value: <span className="capitalize">{client.segment}</span> },
            {
              label: 'Direccion',
              value: primaryLocation ? (
                <span className="flex items-start gap-1.5">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  <span>
                    {primaryLocation.addressLine}, {primaryLocation.communeName}
                  </span>
                </span>
              ) : (
                'Sin direccion registrada'
              ),
              full: true,
            },
            {
              label: 'Contacto',
              value: client.contactName ? (
                <span className="flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-ink-faint" />
                  {client.contactName}
                </span>
              ) : (
                'Sin contacto'
              ),
            },
            {
              label: 'Telefono',
              value: client.phone ? (
                <span className="numeric flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-ink-faint" />
                  {client.phone}
                </span>
              ) : (
                'Sin telefono'
              ),
            },
            { label: 'Vendedor', value: client.salesRep ?? 'Sin asignar' },
            { label: 'Antiguedad', value: formatSmartDateTime(client.createdAt) },
          ]}
        />
      </Section>

      {/* --- Estado comercial --- */}
      <Section title="Estado comercial">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-line bg-surface-800 p-2.5">
            <p className="text-2xs uppercase tracking-wider text-ink-faint">Ultima compra</p>
            <p className="mt-0.5 text-[13px] text-ink">{formatSmartDateTime(client.lastPurchaseAt)}</p>
            <p className="numeric mt-0.5 text-2xs text-ink-faint">
              {formatDays(snapshot.daysSincePurchase)} sin comprar
            </p>
          </div>

          <div className="rounded-md border border-line bg-surface-800 p-2.5">
            <p className="text-2xs uppercase tracking-wider text-ink-faint">Ultima visita</p>
            <p className="mt-0.5 text-[13px] text-ink">{formatSmartDateTime(client.lastVisitAt)}</p>
            <p className="numeric mt-0.5 text-2xs text-ink-faint">
              {formatDays(snapshot.daysSinceVisit)} sin visita
            </p>
          </div>
        </div>

        <DetailList
          columns={3}
          className="mt-2"
          items={[
            { label: 'Pedidos historicos', value: <span className="numeric">{client.totalOrders}</span> },
            { label: 'Entregas OK', value: <span className="numeric">{totals.delivered}</span> },
            { label: 'Incidencias', value: <span className="numeric">{totals.incidents}</span> },
          ]}
        />

        <p className="mt-2 rounded-md border border-line bg-surface-800 px-3 py-2 text-xs">
          <span className="text-ink-faint">Valor acumulado: </span>
          <span className="numeric font-medium text-ink">{formatCurrency(client.lifetimeValue)}</span>
        </p>
      </Section>

      {/* --- Actividad --- */}
      <Section title="Actividad de despacho">
        {activeWorkOrder ? (
          <Link
            href={`/ordenes/${activeWorkOrder.id}`}
            className="block rounded-md border border-brand-500/25 bg-brand-500/5 p-3 transition-colors hover:border-brand-500/50"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-2xs uppercase tracking-wider text-ink-faint">Pedido activo</p>
                <p className="numeric mt-0.5 truncate text-[13px] font-semibold text-brand-700">
                  {activeWorkOrder.number}
                </p>
              </div>
              <WorkOrderStatusBadge status={activeWorkOrder.status} />
            </div>

            {data.assignedVehiclePlate ? (
              <p className="mt-2 flex items-center gap-1.5 text-2xs text-ink-muted">
                <Truck className="h-3.5 w-3.5" />
                Camion asignado {data.assignedVehiclePlate}
              </p>
            ) : null}
          </Link>
        ) : nextWorkOrder ? (
          <Link
            href={`/ordenes/${nextWorkOrder.id}`}
            className="block rounded-md border border-line bg-surface-800 p-3 transition-colors hover:border-line-strong"
          >
            <p className="text-2xs uppercase tracking-wider text-ink-faint">Proximo despacho</p>
            <p className="numeric mt-0.5 truncate text-[13px] font-semibold text-brand-700">
              {nextWorkOrder.number}
            </p>
            <p className="mt-0.5 text-2xs text-ink-faint">
              Programado {formatSmartDateTime(nextWorkOrder.scheduledWindowStart)}
            </p>
          </Link>
        ) : (
          <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
            Este cliente no tiene pedidos activos ni despachos programados.
          </p>
        )}
      </Section>

      {/* --- Visitas --- */}
      <Section title="Visitas detectadas por GPS">
        {visits.length === 0 ? (
          <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
            Aun no hay visitas registradas por geocerca para este cliente.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {visits.slice(0, 5).map((visit) => (
              <li
                key={visit.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-800 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs text-ink">{formatSmartDateTime(visit.date)}</p>
                  <p className="numeric truncate text-2xs text-ink-faint">
                    {visit.vehiclePlate ?? 'Vehiculo desconocido'} ·{' '}
                    {formatDistance(visit.distanceMeters)} del domicilio
                  </p>
                </div>
                <span className="numeric shrink-0 text-2xs text-ink-muted">
                  {formatDuration(visit.dwellSeconds)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <div className="flex items-center gap-2 border-t border-line pt-3">
        <Building2 className="h-3.5 w-3.5 text-ink-faint" />
        <p className="text-2xs text-ink-faint">
          {client.locations.length} direccion(es) de despacho registradas
        </p>
      </div>
    </div>
  );
}
