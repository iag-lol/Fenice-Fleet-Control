'use client';

import { useQuery } from '@tanstack/react-query';
import { Route as RouteIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { ProgressBar } from '@/components/common/progress';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { formatKm, formatTime, normalizeSearch } from '@/lib/format';
import type { Route } from '@/types/core';

interface RouteRow extends Route {
  vehiclePlate: string | null;
  driverName: string | null;
}

const STATUS_TONE = {
  planificada: 'neutral',
  en_curso: 'moving',
  completada: 'active',
  cancelada: 'danger',
} as const;

const STATUS_LABEL = {
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
} as const;

/** Rutas del dia con su avance real de entregas. */
export function RoutesView() {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['routes'],
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ routes: RouteRow[] }> => {
      const response = await fetch('/api/rutas');
      if (!response.ok) throw new Error('No fue posible cargar las rutas.');
      return (await response.json()) as { routes: RouteRow[] };
    },
  });

  const routes = useMemo(() => data?.routes ?? [], [data]);

  const rows = useMemo(() => {
    const term = normalizeSearch(search);
    if (term.length === 0) return routes;
    return routes.filter((route) =>
      normalizeSearch(
        `${route.code} ${route.name} ${route.vehiclePlate ?? ''} ${route.driverName ?? ''}`,
      ).includes(term),
    );
  }, [routes, search]);

  const completedStops = (route: RouteRow): number =>
    route.stops.filter((s) => ['visita_detectada', 'completada'].includes(s.status)).length;

  const columns: Column<RouteRow>[] = [
    {
      key: 'code',
      header: 'Ruta',
      sortValue: (row) => row.code,
      cell: (row) => (
        <div className="min-w-0">
          <p className="numeric truncate font-medium text-brand-700">{row.code}</p>
          <p className="truncate text-2xs text-ink-faint">{row.name}</p>
        </div>
      ),
    },
    {
      key: 'vehicle',
      header: 'Camion',
      sortValue: (row) => row.vehiclePlate ?? '',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{row.vehiclePlate ?? 'Sin asignar'}</p>
          <p className="truncate text-2xs text-ink-faint">{row.driverName ?? 'Sin conductor'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      sortValue: (row) => row.status,
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status]} dot>
          {STATUS_LABEL[row.status]}
        </Badge>
      ),
    },
    {
      key: 'progress',
      header: 'Avance',
      sortValue: (row) => (row.stops.length === 0 ? 0 : completedStops(row) / row.stops.length),
      cell: (row) => (
        <div className="w-28 sm:w-36">
          <ProgressBar
            value={row.stops.length === 0 ? 0 : completedStops(row) / row.stops.length}
            size="sm"
            tone={completedStops(row) === row.stops.length ? 'active' : 'brand'}
          />
          <p className="numeric mt-1 text-2xs text-ink-faint">
            {completedStops(row)}/{row.stops.length} entregas
          </p>
        </div>
      ),
    },
    {
      key: 'distance',
      header: 'Distancia',
      hideBelow: 'lg',
      sortValue: (row) => row.plannedDistanceKm,
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{formatKm(row.plannedDistanceKm)}</span>,
    },
    {
      key: 'start',
      header: 'Inicio',
      hideBelow: 'lg',
      sortValue: (row) => row.startedAt ?? '',
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{formatTime(row.startedAt)}</span>,
    },
    {
      key: 'communes',
      header: 'Comunas autorizadas',
      hideBelow: 'xl',
      cell: (row) => (
        <span className="text-2xs text-ink-faint">{row.authorizedCommuneCodes.length} comunas</span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Rutas"
        description={
          data ? `${routes.length} rutas planificadas para hoy` : 'Cargando rutas...'
        }
      />

      <Card className="overflow-hidden">
        <div className="border-b border-line p-3">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Buscar por codigo, sector, patente o conductor"
            className="sm:max-w-sm"
          />
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
            <SkeletonRows rows={8} />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/rutas/${row.id}`)}
            initialSort={{ key: 'code', direction: 'asc' }}
            empty={
              <EmptyState
                icon={<RouteIcon className="h-5 w-5" />}
                title="No hay rutas que coincidan con la busqueda."
                description="Las rutas se generan al asignar ordenes de trabajo a un vehiculo para una fecha."
              />
            }
            mobileCard={(row) => (
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="numeric truncate text-sm font-medium text-brand-700">{row.code}</p>
                    <p className="truncate text-2xs text-ink-faint">{row.name}</p>
                  </div>
                  <Badge tone={STATUS_TONE[row.status]} dot>
                    {STATUS_LABEL[row.status]}
                  </Badge>
                </div>

                <p className="truncate text-2xs text-ink-muted">
                  {row.vehiclePlate ?? 'Sin camion'} · {row.driverName ?? 'Sin conductor'} ·{' '}
                  {formatKm(row.plannedDistanceKm)}
                </p>

                <ProgressBar
                  value={row.stops.length === 0 ? 0 : completedStops(row) / row.stops.length}
                  label={`${completedStops(row)} de ${row.stops.length} entregas`}
                  size="sm"
                />
              </div>
            )}
          />
        )}
      </Card>
    </>
  );
}
