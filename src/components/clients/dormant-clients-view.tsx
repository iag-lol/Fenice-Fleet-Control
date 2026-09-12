'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, MapPin, MoonStar, RotateCcw, Skull } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { DORMANCY_TIER_LABEL, type DormancyTier } from '@/lib/engines/client-activity';
import { formatCurrency, formatDays, formatSmartDateTime, normalizeSearch } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useErpConnected } from '@/hooks/use-erp-connected';
import type { DormantClientRow } from '@/services/aggregation/client-aggregator';
import { useMapStore } from '@/stores/map-store';

const TIER_TONE: Record<DormancyTier, 'warning' | 'danger'> = {
  en_riesgo: 'warning',
  dormido: 'danger',
  critico: 'danger',
};

const TIER_OPTIONS = [
  { value: '', label: 'Todos los niveles' },
  { value: 'en_riesgo', label: DORMANCY_TIER_LABEL.en_riesgo },
  { value: 'dormido', label: DORMANCY_TIER_LABEL.dormido },
  { value: 'critico', label: DORMANCY_TIER_LABEL.critico },
];

/**
 * Clientes que perdieron actividad comercial, escalonados por gravedad.
 * La accion clave es "mostrar en mapa": permite planificar la recuperacion
 * por sector en vez de cliente por cliente.
 */
export function DormantClientsView() {
  const router = useRouter();
  const setFilters = useMapStore((s) => s.setFilters);
  const setLayer = useMapStore((s) => s.setLayer);
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);
  const erpConnected = useErpConnected();

  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [commune, setCommune] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clients', 'dormant'],
    staleTime: 60_000,
    queryFn: async (): Promise<{ clients: DormantClientRow[] }> => {
      const response = await fetch('/api/clients/dormidos');
      if (!response.ok) throw new Error('No fue posible cargar los clientes dormidos.');
      return (await response.json()) as { clients: DormantClientRow[] };
    },
  });

  const clients = useMemo(() => data?.clients ?? [], [data]);

  const communeOptions = useMemo(() => {
    const names = [...new Set(clients.map((c) => c.communeName))].sort((a, b) =>
      a.localeCompare(b, 'es'),
    );
    return [
      { value: '', label: 'Todas las comunas' },
      ...names.map((name) => ({ value: name, label: name })),
    ];
  }, [clients]);

  const rows = useMemo(() => {
    const term = normalizeSearch(search);
    return clients.filter((client) => {
      if (tier && client.tier !== tier) return false;
      if (commune && client.communeName !== commune) return false;
      if (term.length === 0) return true;
      return normalizeSearch(`${client.name} ${client.code} ${client.salesRep ?? ''}`).includes(term);
    });
  }, [clients, search, tier, commune]);

  const counts = useMemo(() => {
    const result: Record<DormancyTier, number> = { en_riesgo: 0, dormido: 0, critico: 0 };
    for (const client of clients) result[client.tier] += 1;
    return result;
  }, [clients]);

  const hasFilters = Boolean(search || tier || commune);

  const clearFilters = (): void => {
    setSearch('');
    setTier('');
    setCommune('');
  };

  /** Muestra en el mapa exclusivamente el conjunto filtrado. */
  const showSelectionOnMap = (): void => {
    setLayer('clientes', true);
    setLayer('camiones', false);
    setFilters({
      statuses: tier === 'en_riesgo' ? ['warning'] : tier ? ['dormant'] : ['warning', 'dormant'],
      communeCodes: [],
      search,
      orderState: 'todos',
      visitState: 'todos',
      minDaysSincePurchase: null,
      maxDaysSincePurchase: null,
      maxDaysSinceVisit: null,
    });
    router.push('/control');
  };

  const columns: Column<DormantClientRow>[] = [
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
      key: 'tier',
      header: 'Nivel',
      sortValue: (row) => row.tier,
      cell: (row) => <Badge tone={TIER_TONE[row.tier]} dot>{DORMANCY_TIER_LABEL[row.tier]}</Badge>,
    },
    {
      key: 'commune',
      header: 'Comuna',
      sortValue: (row) => row.communeName,
      cell: (row) => <span className="text-ink-muted">{row.communeName}</span>,
    },
    {
      key: 'lastPurchase',
      header: 'Ultima compra',
      hideBelow: 'lg',
      sortValue: (row) => row.lastPurchaseAt ?? '',
      cell: (row) => (
        <span className="text-2xs text-ink-muted">{formatSmartDateTime(row.lastPurchaseAt)}</span>
      ),
    },
    {
      key: 'days',
      header: 'Dias sin comprar',
      sortValue: (row) => row.daysSincePurchase ?? 99_999,
      className: 'numeric',
      cell: (row) => (
        <span
          className={cn(
            row.tier === 'critico'
              ? 'font-medium text-status-dormant'
              : row.tier === 'dormido'
                ? 'text-status-dormant'
                : 'text-status-warning',
          )}
        >
          {formatDays(row.daysSincePurchase)}
        </span>
      ),
    },
    {
      key: 'lastVisit',
      header: 'Ultima visita',
      hideBelow: 'xl',
      sortValue: (row) => row.daysSinceVisit ?? 99_999,
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{formatDays(row.daysSinceVisit)}</span>,
    },
    {
      key: 'rep',
      header: 'Responsable',
      hideBelow: 'xl',
      sortValue: (row) => row.salesRep ?? '',
      cell: (row) => <span className="text-2xs text-ink-muted">{row.salesRep ?? 'Sin asignar'}</span>,
    },
    {
      key: 'orders',
      header: 'Pedidos historicos',
      hideBelow: 'lg',
      sortValue: (row) => row.totalOrders,
      className: 'numeric',
      cell: (row) => <span className="text-ink-muted">{row.totalOrders}</span>,
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
      cell: (row) =>
        row.lat !== null && row.lng !== null ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              select({ type: 'client', id: row.clientId });
              focusOn({ lat: row.lat!, lng: row.lng! }, 16);
              router.push('/control');
            }}
          >
            Ver en mapa
          </Button>
        ) : (
          <span className="text-2xs text-ink-faint">Sin coordenadas</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Clientes dormidos"
        description="Cartera que perdio actividad comercial, escalonada por gravedad segun los umbrales configurados."
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<MapPin className="h-3.5 w-3.5" />}
            onClick={showSelectionOnMap}
          >
            Mostrar en mapa
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-2.5 sm:gap-3">
        {(Object.keys(counts) as DormancyTier[]).map((key) => {
          const TierIcon = key === 'en_riesgo' ? AlertTriangle : key === 'dormido' ? MoonStar : Skull;
          const active = tier === key;
          const tone =
            key === 'en_riesgo'
              ? { text: 'text-status-warning', chip: 'bg-status-warning/10 text-status-warning' }
              : { text: 'text-status-dormant', chip: 'bg-status-dormant/10 text-status-dormant' };

          return (
            <button
              key={key}
              type="button"
              onClick={() => setTier(active ? '' : key)}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 text-left shadow-card transition-all sm:p-4',
                active
                  ? 'border-brand-500 bg-brand-500/10 shadow-float'
                  : 'border-line bg-surface-850 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float',
              )}
            >
              <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', tone.chip)}>
                <TierIcon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-2xs font-medium uppercase tracking-wider text-ink-faint">
                  {DORMANCY_TIER_LABEL[key]}
                </span>
                <span className={cn('numeric block text-2xl font-semibold leading-none', tone.text)}>
                  {counts[key]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-2.5 border-b border-line p-3 sm:grid-cols-3">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Nombre, codigo o responsable"
          />
          <Select
            value={tier}
            onChange={(event) => setTier(event.target.value)}
            options={TIER_OPTIONS}
            aria-label="Filtrar por nivel de riesgo"
          />
          <Select
            value={commune}
            onChange={(event) => setCommune(event.target.value)}
            options={communeOptions}
            aria-label="Filtrar por comuna"
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
                icon={<MoonStar className="h-5 w-5" />}
                title={
                  !erpConnected && !hasFilters
                    ? 'Clientes sin fuente conectada.'
                    : 'No hay clientes que coincidan con los filtros seleccionados.'
                }
                description={
                  !erpConnected && !hasFilters
                    ? 'La cartera de clientes vive en la base de datos de Fenice, que aun no esta configurada (EXTERNAL_DB_*).'
                    : 'Toda la cartera filtrada se mantiene dentro del umbral de actividad configurado.'
                }
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
                  <Badge tone={TIER_TONE[row.tier]} dot>
                    {DORMANCY_TIER_LABEL[row.tier]}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ink-muted">
                  <span className="numeric">Sin comprar: {formatDays(row.daysSincePurchase)}</span>
                  <span className="numeric">Sin visita: {formatDays(row.daysSinceVisit)}</span>
                </div>

                <p className="truncate text-2xs text-ink-faint">
                  Responsable: {row.salesRep ?? 'Sin asignar'}
                </p>
              </div>
            )}
          />
        )}
      </Card>
    </>
  );
}
