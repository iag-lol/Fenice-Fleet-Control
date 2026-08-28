'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, MapPin, RotateCcw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { ClientStatusBadge } from '@/components/common/status';
import { Button, LinkButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { CLIENT_STATUS_LABEL } from '@/lib/engines/client-activity';
import { formatCurrency, formatDays, normalizeSearch } from '@/lib/format';
import { useMapStore } from '@/stores/map-store';
import type { ClientActivityStatus } from '@/types/core';
import type { ClientMapPoint } from '@/types/views';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  { value: 'active', label: CLIENT_STATUS_LABEL.active },
  { value: 'warning', label: CLIENT_STATUS_LABEL.warning },
  { value: 'dormant', label: CLIENT_STATUS_LABEL.dormant },
];

const ORDER_OPTIONS = [
  { value: '', label: 'Todos los pedidos' },
  { value: 'con_pedido', label: 'Con pedido pendiente' },
  { value: 'sin_pedido', label: 'Sin pedido' },
];

/** Cartera de clientes con estado comercial calculado en el servidor. */
export function ClientsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);
  const setFilters = useMapStore((s) => s.setFilters);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('estado') ?? '');
  const [commune, setCommune] = useState(searchParams.get('comuna') ?? '');
  const [orderState, setOrderState] = useState('');

  useEffect(() => {
    setStatus(searchParams.get('estado') ?? '');
  }, [searchParams]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clients'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ clients: ClientMapPoint[] }> => {
      const response = await fetch('/api/clients');
      if (!response.ok) throw new Error('No fue posible cargar los clientes.');
      return (await response.json()) as { clients: ClientMapPoint[] };
    },
  });

  const clients = useMemo(() => data?.clients ?? [], [data]);

  const communeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const client of clients) map.set(client.communeCode, client.communeName);
    return [
      { value: '', label: 'Todas las comunas' },
      ...[...map.entries()]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es')),
    ];
  }, [clients]);

  const rows = useMemo(() => {
    const term = normalizeSearch(search);

    return clients.filter((client) => {
      if (status && client.status !== status) return false;
      if (commune && client.communeCode !== commune) return false;
      if (orderState === 'con_pedido' && !client.hasPendingOrder) return false;
      if (orderState === 'sin_pedido' && client.hasPendingOrder) return false;
      if (term.length === 0) return true;

      return normalizeSearch(`${client.name} ${client.code} ${client.addressLine} ${client.communeName}`).includes(
        term,
      );
    });
  }, [clients, search, status, commune, orderState]);

  const hasFilters = Boolean(search || status || commune || orderState);

  const clearFilters = (): void => {
    setSearch('');
    setStatus('');
    setCommune('');
    setOrderState('');
    router.replace('/clientes');
  };

  const showOnMap = (client: ClientMapPoint): void => {
    select({ type: 'client', id: client.clientId });
    focusOn({ lat: client.lat, lng: client.lng }, 16);
    router.push('/control');
  };

  const columns: Column<ClientMapPoint>[] = [
    {
      key: 'name',
      header: 'Cliente',
      sortValue: (row) => row.name,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.name}</p>
          <p className="numeric truncate text-2xs text-ink-faint">{row.code}</p>
        </div>
      ),
    },
    {
      key: 'commune',
      header: 'Comuna',
      sortValue: (row) => row.communeName,
      cell: (row) => <span className="text-ink-muted">{row.communeName}</span>,
    },
    {
      key: 'address',
      header: 'Direccion',
      hideBelow: 'xl',
      sortValue: (row) => row.addressLine,
      cell: (row) => <span className="truncate text-2xs text-ink-faint">{row.addressLine}</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      sortValue: (row) => row.status,
      cell: (row) => <ClientStatusBadge status={row.status} />,
    },
    {
      key: 'days',
      header: 'Sin comprar',
      sortValue: (row) => row.daysSincePurchase ?? 99_999,
      className: 'numeric',
      cell: (row) => (
        <span
          className={
            row.status === 'dormant'
              ? 'text-status-dormant'
              : row.status === 'warning'
                ? 'text-status-warning'
                : 'text-ink-muted'
          }
        >
          {formatDays(row.daysSincePurchase)}
        </span>
      ),
    },
    {
      key: 'visit',
      header: 'Sin visita',
      hideBelow: 'lg',
      sortValue: (row) => row.daysSinceVisit ?? 99_999,
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{formatDays(row.daysSinceVisit)}</span>,
    },
    {
      key: 'value',
      header: 'Valor acumulado',
      hideBelow: 'xl',
      sortValue: (row) => row.lifetimeValue,
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{formatCurrency(row.lifetimeValue)}</span>,
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            showOnMap(row);
          }}
        >
          Ver en mapa
        </Button>
      ),
    },
  ];

  const counts = useMemo(() => {
    const result: Record<ClientActivityStatus, number> = { active: 0, warning: 0, dormant: 0 };
    for (const client of clients) result[client.status] += 1;
    return result;
  }, [clients]);

  return (
    <>
      <PageHeader
        title="Clientes"
        description={
          data
            ? `${clients.length} clientes geolocalizados · ${counts.active} activos, ${counts.warning} en observacion, ${counts.dormant} dormidos`
            : 'Cargando cartera...'
        }
        actions={
          <>
            <LinkButton href="/clientes/dormidos" variant="secondary" size="sm">
              Clientes dormidos
            </LinkButton>
            <Button
              variant="secondary"
              size="sm"
              icon={<MapPin className="h-3.5 w-3.5" />}
              onClick={() => {
                setFilters({
                  statuses: status ? [status as ClientActivityStatus] : ['active', 'warning', 'dormant'],
                  communeCodes: commune ? [commune] : [],
                  search,
                });
                router.push('/control');
              }}
            >
              Ver seleccion en el mapa
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="grid gap-2.5 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Nombre, codigo o direccion"
          />
          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={STATUS_OPTIONS}
            aria-label="Filtrar por estado comercial"
          />
          <Select
            value={commune}
            onChange={(event) => setCommune(event.target.value)}
            options={communeOptions}
            aria-label="Filtrar por comuna"
          />
          <Select
            value={orderState}
            onChange={(event) => setOrderState(event.target.value)}
            options={ORDER_OPTIONS}
            aria-label="Filtrar por pedidos"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <p className="text-xs text-ink-faint">
            <span className="numeric font-medium text-ink">{rows.length}</span> de{' '}
            <span className="numeric">{clients.length}</span> clientes visibles
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
            rowKey={(row) => row.clientId}
            onRowClick={(row) => router.push(`/clientes/${row.clientId}`)}
            initialSort={{ key: 'days', direction: 'desc' }}
            empty={
              <EmptyState
                icon={<Building2 className="h-5 w-5" />}
                title="No hay clientes que coincidan con los filtros seleccionados."
                description="Ajusta el estado comercial, la comuna o el termino de busqueda para ampliar el resultado."
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
                    <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                    <p className="numeric truncate text-2xs text-ink-faint">
                      {row.code} · {row.communeName}
                    </p>
                  </div>
                  <ClientStatusBadge status={row.status} />
                </div>

                <p className="truncate text-2xs text-ink-faint">{row.addressLine}</p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
                  <span className="numeric text-ink-muted">
                    Sin comprar: {formatDays(row.daysSincePurchase)}
                  </span>
                  {row.hasPendingOrder ? (
                    <span className="text-brand-700">Pedido pendiente</span>
                  ) : null}
                  {row.visitedToday ? <span className="text-status-active">Visitado hoy</span> : null}
                </div>
              </div>
            )}
          />
        )}
      </Card>
    </>
  );
}
