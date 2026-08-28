'use client';

import { useQuery } from '@tanstack/react-query';
import { MapPin, PackageCheck, RotateCcw } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Stat } from '@/components/common/kpi';
import { PageHeader } from '@/components/common/page-header';
import { PriorityBadge, WorkOrderStatusBadge } from '@/components/common/status';
import { PlanBadge } from '@/components/product/plan-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { formatNumber, formatTime, normalizeSearch } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { WorkOrder } from '@/types/core';

interface DispatchRow extends WorkOrder {
  vehiclePlate: string | null;
  driverName: string | null;
}

/** Estado del compromiso de entrega frente a la ventana pactada. */
type SlaState = 'a_tiempo' | 'en_riesgo' | 'atrasada' | 'cerrada';

const SLA_LABEL: Record<SlaState, string> = {
  a_tiempo: 'A tiempo',
  en_riesgo: 'En riesgo',
  atrasada: 'Atrasada',
  cerrada: 'Cerrada',
};

const SLA_TONE = {
  a_tiempo: 'active',
  en_riesgo: 'warning',
  atrasada: 'danger',
  cerrada: 'neutral',
} as const;

/**
 * Cumplimiento del compromiso de entrega.
 *
 * "En riesgo" se evalua ANTES de que ocurra el incumplimiento: avisar cuando
 * la ventana ya se paso no le sirve a nadie. El margen es de 30 minutos, que
 * es aproximadamente lo que toma una descarga de combustible.
 */
const RISK_MARGIN_MINUTES = 30;

function resolveSla(workOrder: WorkOrder, now: Date): SlaState {
  if (['visita_detectada', 'completada', 'cancelada'].includes(workOrder.status)) return 'cerrada';
  if (!workOrder.scheduledWindowEnd) return 'a_tiempo';

  const deadline = new Date(workOrder.scheduledWindowEnd).getTime();
  if (Number.isNaN(deadline)) return 'a_tiempo';

  const remainingMinutes = (deadline - now.getTime()) / 60_000;
  if (remainingMinutes < 0) return 'atrasada';
  if (remainingMinutes <= RISK_MARGIN_MINUTES) return 'en_riesgo';
  return 'a_tiempo';
}

/**
 * Panel de despachos en curso.
 *
 * Responde la pregunta del jefe de operaciones: que entregas van bien, cuales
 * estan por incumplir y cuales ya incumplieron. Pulsar una fila lleva al
 * camion en el mapa.
 */
export function DispatchBoardView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);

  const [search, setSearch] = useState('');
  const [slaFilter, setSlaFilter] = useState(searchParams.get('sla') ?? '');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dispatch-board'],
    refetchInterval: 45_000,
    queryFn: async (): Promise<{ workOrders: DispatchRow[] }> => {
      const response = await fetch(
        `/api/ordenes?fecha=${encodeURIComponent(new Date().toISOString())}`,
      );
      if (!response.ok) throw new Error('No fue posible cargar los despachos.');
      return (await response.json()) as { workOrders: DispatchRow[] };
    },
  });

  const workOrders = useMemo(() => data?.workOrders ?? [], [data]);

  // El instante de evaluacion se toma dentro del propio calculo: asi el
  // cumplimiento se recalcula con cada lote de datos en lugar de quedar
  // congelado en el momento de la primera carga.
  const enriched = useMemo(() => {
    const now = new Date();
    return workOrders.map((w) => ({ ...w, sla: resolveSla(w, now) }));
  }, [workOrders]);

  const inProgress = useMemo(() => enriched.filter((w) => w.sla !== 'cerrada'), [enriched]);

  const totals = useMemo(() => {
    const counts = { a_tiempo: 0, en_riesgo: 0, atrasada: 0, cerrada: 0 };
    for (const row of enriched) counts[row.sla] += 1;
    return counts;
  }, [enriched]);

  const rows = useMemo(() => {
    const term = normalizeSearch(search);
    return inProgress.filter((row) => {
      if (slaFilter && row.sla !== slaFilter) return false;
      if (term.length === 0) return true;
      return normalizeSearch(
        `${row.number} ${row.clientName} ${row.communeName} ${row.vehiclePlate ?? ''} ${row.driverName ?? ''}`,
      ).includes(term);
    });
  }, [inProgress, search, slaFilter]);

  const hasFilters = Boolean(search || slaFilter);

  const clearFilters = (): void => {
    setSearch('');
    setSlaFilter('');
    router.replace('/despachos');
  };

  const openOnMap = (row: DispatchRow): void => {
    if (row.vehicleId) select({ type: 'vehicle', id: row.vehicleId });
    else select({ type: 'workOrder', id: row.id });
    if (row.coordinates) focusOn(row.coordinates, 15);
    router.push('/control');
  };

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'number',
      header: 'OT',
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
      header: 'Ventana',
      hideBelow: 'md',
      sortValue: (row) => row.scheduledWindowEnd ?? '',
      className: 'numeric',
      cell: (row) => (
        <span className="text-ink-muted">
          {formatTime(row.scheduledWindowStart)} – {formatTime(row.scheduledWindowEnd)}
        </span>
      ),
    },
    {
      key: 'sla',
      header: 'Compromiso',
      sortValue: (row) => row.sla,
      cell: (row) => (
        <Badge tone={SLA_TONE[row.sla]} dot>
          {SLA_LABEL[row.sla]}
        </Badge>
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
      cell: (row) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            openOnMap(row);
          }}
        >
          Ver en mapa
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Despachos en curso"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>Entregas del dia y su cumplimiento frente a la ventana comprometida.</span>
            <PlanBadge featureId="dispatch-board" />
          </span>
        }
      />

      <Card className="mb-4">
        <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="En curso" value={formatNumber(inProgress.length)} tone="brand" />
          <Stat label="A tiempo" value={formatNumber(totals.a_tiempo)} tone="active" />
          <Stat
            label="En riesgo"
            value={formatNumber(totals.en_riesgo)}
            tone={totals.en_riesgo > 0 ? 'warning' : 'neutral'}
          />
          <Stat
            label="Atrasadas"
            value={formatNumber(totals.atrasada)}
            tone={totals.atrasada > 0 ? 'danger' : 'neutral'}
          />
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <div className="grid gap-2.5 border-b border-line p-3 sm:grid-cols-2">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="OT, cliente, comuna, patente o conductor"
          />
          <Select
            value={slaFilter}
            onChange={(event) => setSlaFilter(event.target.value)}
            aria-label="Filtrar por compromiso"
            options={[
              { value: '', label: 'Todos los compromisos' },
              { value: 'a_tiempo', label: SLA_LABEL.a_tiempo },
              { value: 'en_riesgo', label: SLA_LABEL.en_riesgo },
              { value: 'atrasada', label: SLA_LABEL.atrasada },
            ]}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <p className="text-xs text-ink-faint">
            <span className="numeric font-medium text-ink">{rows.length}</span> de{' '}
            <span className="numeric">{inProgress.length}</span> despachos en curso
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
            <SkeletonRows rows={8} />
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
                icon={<PackageCheck className="h-5 w-5" />}
                title="No hay despachos en curso que coincidan."
                description="Todas las entregas del dia estan cerradas, o los filtros son demasiado restrictivos."
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
                    <p className="numeric truncate text-sm font-medium text-brand-700">
                      {row.number}
                    </p>
                    <p className="truncate text-2xs text-ink-faint">{row.clientName}</p>
                  </div>
                  <Badge tone={SLA_TONE[row.sla]} dot>
                    {SLA_LABEL[row.sla]}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-faint">
                  <span className="numeric">
                    {formatTime(row.scheduledWindowStart)} – {formatTime(row.scheduledWindowEnd)}
                  </span>
                  <span className={cn(!row.vehiclePlate && 'text-status-warning')}>
                    {row.vehiclePlate ?? 'Sin camion'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <WorkOrderStatusBadge status={row.status} />
                  <PriorityBadge priority={row.priority} />
                </div>
              </div>
            )}
          />
        )}
      </Card>

      <p className="mt-3 flex items-center gap-1.5 text-2xs text-ink-faint">
        <MapPin className="h-3 w-3" />
        Una entrega pasa a &ldquo;en riesgo&rdquo; {RISK_MARGIN_MINUTES} minutos antes de que venza
        su ventana, no cuando ya la incumplio.
      </p>
    </>
  );
}
