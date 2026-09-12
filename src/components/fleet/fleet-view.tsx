'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge, MapPin, Navigation, Plus, RotateCcw, Truck, User, WifiOff } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { StatChipRow } from '@/components/common/stat-chip';
import { ConnectionBadge, VehicleStatusBadge } from '@/components/common/status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { VehicleCreateSheet } from '@/components/fleet/vehicle-create-sheet';
import { useLiveFleet, useSecondsSince } from '@/hooks/use-live-fleet';
import { VEHICLE_STATUS_LABEL } from '@/lib/engines/gps-health';
import { formatElapsed, formatSpeed, normalizeSearch } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { VehicleOperationalStatus, VehicleSnapshot } from '@/types/core';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos los estados' },
  ...(Object.keys(VEHICLE_STATUS_LABEL) as VehicleOperationalStatus[]).map((status) => ({
    value: status,
    label: VEHICLE_STATUS_LABEL[status],
  })),
];

/** Listado de flota con telemetria viva y filtros operacionales. */
export function FleetView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { positions, lastUpdateAt } = useLiveFleet();
  const secondsSinceUpdate = useSecondsSince(lastUpdateAt);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('estado') ?? '');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fleet'],
    refetchInterval: 30_000,
    queryFn: async (): Promise<VehicleSnapshot[]> => {
      const response = await fetch('/api/fleet');
      if (!response.ok) throw new Error('No fue posible cargar la flota.');
      return (await response.json()) as VehicleSnapshot[];
    },
  });

  const rows = useMemo(() => {
    if (!data) return [];
    const term = normalizeSearch(search);

    return data.filter((snapshot) => {
      if (status && snapshot.status !== status) return false;
      if (term.length === 0) return true;

      const haystack = normalizeSearch(
        `${snapshot.vehicle.plate} ${snapshot.vehicle.fleetCode} ${snapshot.vehicle.brand} ${snapshot.vehicle.model} ${snapshot.driver?.fullName ?? ''} ${snapshot.vehicle.depotName}`,
      );
      return haystack.includes(term);
    });
  }, [data, search, status]);

  const counts = useMemo(() => {
    const result = { en_ruta: 0, detenido: 0, offline: 0 };
    for (const snapshot of data ?? []) {
      if (snapshot.status === 'en_ruta') result.en_ruta += 1;
      else if (snapshot.status === 'detenido') result.detenido += 1;
      else if (snapshot.status === 'offline') result.offline += 1;
    }
    return result;
  }, [data]);

  const hasFilters = search.trim().length > 0 || status.length > 0;

  const clearFilters = (): void => {
    setSearch('');
    setStatus('');
    router.replace('/flota');
  };

  const livePosition = (snapshot: VehicleSnapshot) =>
    positions.get(snapshot.vehicle.id) ?? snapshot.position;

  const columns: Column<VehicleSnapshot>[] = [
    {
      key: 'plate',
      header: 'Vehiculo',
      sortValue: (row) => row.vehicle.plate,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{row.vehicle.plate}</p>
          <p className="numeric truncate text-2xs text-ink-faint">{row.vehicle.fleetCode}</p>
        </div>
      ),
    },
    {
      key: 'model',
      header: 'Marca y modelo',
      hideBelow: 'lg',
      sortValue: (row) => `${row.vehicle.brand} ${row.vehicle.model}`,
      cell: (row) => (
        <span className="text-ink-muted">
          {row.vehicle.brand} {row.vehicle.model}
        </span>
      ),
    },
    {
      key: 'driver',
      header: 'Conductor',
      sortValue: (row) => row.driver?.fullName ?? '',
      cell: (row) => (
        <span className="text-ink-muted">{row.driver?.fullName ?? 'Sin asignar'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      sortValue: (row) => row.status,
      cell: (row) => <VehicleStatusBadge status={row.status} />,
    },
    {
      key: 'speed',
      header: 'Velocidad',
      sortValue: (row) => livePosition(row)?.speed ?? -1,
      className: 'numeric',
      cell: (row) => {
        const position = livePosition(row);
        return position ? (
          <span className={position.speed > 3 ? 'text-brand-700' : 'text-ink-muted'}>
            {formatSpeed(position.speed)}
          </span>
        ) : (
          <span className="text-ink-faint">--</span>
        );
      },
    },
    {
      key: 'connection',
      header: 'Telemetria',
      hideBelow: 'xl',
      sortValue: (row) => row.device?.secondsSinceLastPosition ?? 999_999,
      cell: (row) =>
        row.device ? (
          <div className="space-y-1">
            <ConnectionBadge state={row.device.connection} />
            <p className="numeric text-2xs text-ink-faint">
              {formatElapsed(row.device.secondsSinceLastPosition)}
            </p>
          </div>
        ) : (
          <span className="text-2xs text-ink-faint">Sin equipo instalado</span>
        ),
    },
    {
      key: 'depot',
      header: 'Base',
      hideBelow: 'xl',
      sortValue: (row) => row.vehicle.depotName,
      cell: (row) => <span className="text-2xs text-ink-faint">{row.vehicle.depotName}</span>,
    },
    {
      key: 'alerts',
      header: 'Alertas',
      sortValue: (row) => row.openAlertCount,
      className: 'numeric',
      cell: (row) =>
        row.openAlertCount > 0 ? (
          <span className="font-medium text-status-warning">{row.openAlertCount}</span>
        ) : (
          <span className="text-ink-faint">0</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Flota"
        description={
          data ? (
            <div className="space-y-1.5">
              <StatChipRow
                items={[
                  {
                    key: 'total',
                    label: 'vehiculos',
                    value: data.length,
                    icon: <Truck className="h-3.5 w-3.5" />,
                  },
                  {
                    key: 'en_ruta',
                    label: 'en ruta',
                    value: counts.en_ruta,
                    icon: <Navigation className="h-3.5 w-3.5" />,
                    tone: 'brand',
                    active: status === 'en_ruta',
                    onClick: () => setStatus(status === 'en_ruta' ? '' : 'en_ruta'),
                  },
                  {
                    key: 'detenido',
                    label: 'detenidos',
                    value: counts.detenido,
                    icon: <Gauge className="h-3.5 w-3.5" />,
                    tone: 'warning',
                    active: status === 'detenido',
                    onClick: () => setStatus(status === 'detenido' ? '' : 'detenido'),
                  },
                  {
                    key: 'offline',
                    label: 'sin señal',
                    value: counts.offline,
                    icon: <WifiOff className="h-3.5 w-3.5" />,
                    tone: 'danger',
                    active: status === 'offline',
                    onClick: () => setStatus(status === 'offline' ? '' : 'offline'),
                  },
                ]}
              />
              <p className="text-2xs text-ink-faint">
                Telemetria actualizada {formatElapsed(secondsSinceUpdate)}
              </p>
            </div>
          ) : (
            'Cargando vehiculos...'
          )
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => setCreating(true)}
          >
            Nuevo vehiculo
          </Button>
        }
      />

      <VehicleCreateSheet open={creating} onClose={() => setCreating(false)} />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-2.5 border-b border-line p-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Buscar por patente, codigo, modelo o conductor"
            className="sm:max-w-sm"
          />

          <Select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={STATUS_OPTIONS}
            className="sm:w-56"
            aria-label="Filtrar por estado"
          />

          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={clearFilters}
              className="sm:ml-auto"
            >
              Limpiar filtros
            </Button>
          ) : null}

          {data && hasFilters ? (
            <p className="text-xs text-ink-faint sm:ml-auto">
              <span className="numeric font-medium text-ink">{rows.length}</span> de{' '}
              <span className="numeric">{data.length}</span> vehiculos
            </p>
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
            <SkeletonRows rows={8} />
          </div>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(row) => row.vehicle.id}
            onRowClick={(row) => router.push(`/flota/${row.vehicle.id}`)}
            initialSort={{ key: 'plate', direction: 'asc' }}
            empty={
              <EmptyState
                icon={<Truck className="h-5 w-5" />}
                title="No hay vehiculos que coincidan con los filtros seleccionados."
                description="Ajusta la busqueda o el estado para ver otros vehiculos de la flota."
                action={
                  hasFilters ? (
                    <Button size="sm" variant="secondary" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            }
            mobileCard={(row) => {
              const position = livePosition(row);

              return (
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{row.vehicle.plate}</p>
                      <p className="numeric truncate text-2xs text-ink-faint">
                        {row.vehicle.fleetCode} · {row.vehicle.brand} {row.vehicle.model}
                      </p>
                    </div>
                    <VehicleStatusBadge status={row.status} />
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {row.driver?.fullName ?? 'Sin conductor'}
                    </span>
                    <span className={cn('numeric flex items-center gap-1', position && position.speed > 3 && 'text-brand-700')}>
                      <Gauge className="h-3 w-3" />
                      {formatSpeed(position?.speed ?? null)}
                    </span>
                    <span className="numeric flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {formatElapsed(row.device?.secondsSinceLastPosition ?? null)}
                    </span>
                  </div>

                  {row.openAlertCount > 0 ? (
                    <p className="text-2xs text-status-warning">
                      {row.openAlertCount} alerta(s) abierta(s)
                    </p>
                  ) : null}
                </div>
              );
            }}
          />
        )}
      </Card>
    </>
  );
}
