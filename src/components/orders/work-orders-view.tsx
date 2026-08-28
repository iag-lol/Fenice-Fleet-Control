'use client';

import { useQuery } from '@tanstack/react-query';
import { ClipboardList, MapPin, RotateCcw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { PriorityBadge, WORK_ORDER_STATUS_LABEL, WorkOrderStatusBadge } from '@/components/common/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { formatDistance, formatSmartDateTime, formatTime, normalizeSearch } from '@/lib/format';
import { useMapStore } from '@/stores/map-store';
import type { WorkOrder, WorkOrderStatus } from '@/types/core';

interface WorkOrderRow extends WorkOrder {
  vehiclePlate: string | null;
  driverName: string | null;
}

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  ...(Object.keys(WORK_ORDER_STATUS_LABEL) as WorkOrderStatus[]).map((status) => ({
    value: status,
    label: WORK_ORDER_STATUS_LABEL[status],
  })),
];

const DATE_OPTIONS = [
  { value: 'hoy', label: 'Hoy' },
  { value: 'todas', label: 'Todas las fechas disponibles' },
];

/** Modulo de ordenes de trabajo con todos sus estados operacionales. */
export function WorkOrdersView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('estado') ?? '');
  const [dateScope, setDateScope] = useState('hoy');
  const clientFilter = searchParams.get('cliente');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['work-orders', dateScope],
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ workOrders: WorkOrderRow[] }> => {
      const url =
        dateScope === 'hoy'
          ? `/api/ordenes?fecha=${encodeURIComponent(new Date().toISOString())}`
          : '/api/ordenes';
      const response = await fetch(url);
      if (!response.ok) throw new Error('No fue posible cargar las ordenes de trabajo.');
      return (await response.json()) as { workOrders: WorkOrderRow[] };
    },
  });

  const workOrders = useMemo(() => data?.workOrders ?? [], [data]);

  const rows = useMemo(() => {
    const term = normalizeSearch(search);

    return workOrders.filter((workOrder) => {
      if (status && workOrder.status !== status) return false;
      if (clientFilter && workOrder.clientId !== clientFilter) return false;
      if (term.length === 0) return true;

      return normalizeSearch(
        `${workOrder.number} ${workOrder.orderNumber} ${workOrder.clientName} ${workOrder.addressLine} ${workOrder.communeName} ${workOrder.vehiclePlate ?? ''}`,
      ).includes(term);
    });
  }, [workOrders, search, status, clientFilter]);

  const hasFilters = Boolean(search || status || clientFilter);

  const clearFilters = (): void => {
    setSearch('');
    setStatus('');
    router.replace('/ordenes');
  };

  const columns: Column<WorkOrderRow>[] = [
    {
      key: 'number',
      header: 'OT / Pedido',
      sortValue: (row) => row.number,
      cell: (row) => (
        <div className="min-w-0">
          <p className="numeric truncate font-medium text-brand-700">{row.number}</p>
          <p className="numeric truncate text-2xs text-ink-faint">{row.orderNumber}</p>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      sortValue: (row) => row.clientName,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{row.clientName}</p>
          <p className="truncate text-2xs text-ink-faint">{row.communeName}</p>
        </div>
      ),
    },
    {
      key: 'address',
      header: 'Direccion',
      hideBelow: 'xl',
      sortValue: (row) => row.addressLine,
      cell: (row) => <span className="truncate text-2xs text-ink-faint">{row.addressLine}</span>,
    },
    {
      key: 'vehicle',
      header: 'Camion',
      hideBelow: 'lg',
      sortValue: (row) => row.vehiclePlate ?? '',
      cell: (row) =>
        row.vehiclePlate ? (
          <div className="min-w-0">
            <p className="truncate text-ink-muted">{row.vehiclePlate}</p>
            <p className="truncate text-2xs text-ink-faint">{row.driverName ?? 'Sin conductor'}</p>
          </div>
        ) : (
          <span className="text-2xs text-status-warning">Sin asignar</span>
        ),
    },
    {
      key: 'window',
      header: 'Hora prevista',
      hideBelow: 'lg',
      sortValue: (row) => row.scheduledWindowStart ?? '',
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{formatTime(row.scheduledWindowStart)}</span>,
    },
    {
      key: 'arrival',
      header: 'Llegada real',
      hideBelow: 'xl',
      sortValue: (row) => row.actualArrivalAt ?? '',
      className: 'numeric',
      cell: (row) =>
        row.actualArrivalAt ? (
          <div>
            <p className="text-status-active">{formatTime(row.actualArrivalAt)}</p>
            {row.closestApproachMeters !== null ? (
              <p className="text-2xs text-ink-faint">
                a {formatDistance(row.closestApproachMeters)}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-ink-faint">--</span>
        ),
    },
    {
      key: 'status',
      header: 'Estado',
      sortValue: (row) => row.status,
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <WorkOrderStatusBadge status={row.status} />
          <PriorityBadge priority={row.priority} />
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) =>
        row.coordinates ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              select({ type: 'workOrder', id: row.id });
              focusOn(row.coordinates!, 16);
              router.push('/mapa');
            }}
          >
            Ver en mapa
          </Button>
        ) : (
          <span className="text-2xs text-status-warning">Sin coordenadas</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Ordenes de trabajo"
        description={
          data
            ? `${workOrders.length} ordenes en la vista seleccionada`
            : 'Cargando ordenes de trabajo...'
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<MapPin className="h-3.5 w-3.5" />}
            onClick={() => router.push('/mapa')}
          >
            Ver en el mapa
          </Button>
        }
      />

      <Card className="overflow-hidden">
        <div className="grid gap-2.5 border-b border-line p-3 sm:grid-cols-3">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="OT, pedido, cliente, direccion o patente"
          />
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={STATUS_OPTIONS}
            aria-label="Filtrar por estado"
          />
          <Select
            value={dateScope}
            onChange={(event) => setDateScope(event.target.value)}
            options={DATE_OPTIONS}
            aria-label="Rango de fechas"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <p className="text-xs text-ink-faint">
            <span className="numeric font-medium text-ink">{rows.length}</span> de{' '}
            <span className="numeric">{workOrders.length}</span> ordenes visibles
            {clientFilter ? <span className="ml-2 text-brand-700">· filtrado por cliente</span> : null}
          </p>
          {hasFilters ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={clearFilters}
            >
              Limpiar filtros
            </Button>
          ) : null}
        </div>

        {isError ? (
          <div className="p-4">
            <QueryError
              message={error instanceof Error ? error.message : undefined}
              onRetry={() => void refetch()}
            />
          </div>
        ) : isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={10} />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/ordenes/${row.id}`)}
            initialSort={{ key: 'window', direction: 'asc' }}
            empty={
              <EmptyState
                icon={<ClipboardList className="h-5 w-5" />}
                title="No hay ordenes que coincidan con los filtros seleccionados."
                description="Cambia el estado, el rango de fechas o el termino de busqueda para ver otras ordenes."
                action={
                  hasFilters ? (
                    <Button size="sm" variant="secondary" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            }
            mobileCard={(row) => (
              <div className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="numeric truncate text-sm font-medium text-brand-700">{row.number}</p>
                    <p className="truncate text-2xs text-ink-faint">{row.orderNumber}</p>
                  </div>
                  <WorkOrderStatusBadge status={row.status} />
                </div>

                <p className="truncate text-[13px] text-ink">{row.clientName}</p>
                <p className="truncate text-2xs text-ink-faint">
                  {row.addressLine}, {row.communeName}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
                  <span className="numeric">Prevista {formatTime(row.scheduledWindowStart)}</span>
                  {row.vehiclePlate ? (
                    <span>{row.vehiclePlate}</span>
                  ) : (
                    <span className="text-status-warning">Sin camion</span>
                  )}
                  {row.actualArrivalAt ? (
                    <span className="numeric text-status-active">
                      Llego {formatTime(row.actualArrivalAt)}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          />
        )}
      </Card>

      {dateScope === 'todas' && workOrders.length > 0 ? (
        <p className="mt-3 text-2xs text-ink-faint">
          Ventana de datos disponible: {formatSmartDateTime(workOrders[workOrders.length - 1]?.scheduledDate)} —{' '}
          {formatSmartDateTime(workOrders[0]?.scheduledDate)}
        </p>
      ) : null}
    </>
  );
}
