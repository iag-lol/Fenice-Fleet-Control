'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Flame, MapPin, TrendingDown } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Stat } from '@/components/common/kpi';
import { PageHeader } from '@/components/common/page-header';
import { ProgressBar } from '@/components/common/progress';
import { FleetMap } from '@/components/map/fleet-map';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { HeatmapMode, TerritoryAnalysis } from '@/types/views';

const HEATMAP_OPTIONS: { value: HeatmapMode; label: string }[] = [
  { value: 'clients', label: 'Concentracion de clientes' },
  { value: 'orders', label: 'Concentracion de pedidos (30 dias)' },
  { value: 'visits', label: 'Concentracion de visitas' },
  { value: 'dormant', label: 'Concentracion de clientes dormidos' },
];

/**
 * Inteligencia territorial.
 *
 * Responde donde esta la cartera, donde se esta perdiendo y donde no hay
 * presencia. La cobertura se define como proporcion de clientes ACTIVOS: una
 * comuna llena de clientes dormidos no esta cubierta.
 */
export function TerritoryView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusOn = useMapStore((s) => s.focusOn);
  const setLayer = useMapStore((s) => s.setLayer);
  const setHeatmapMode = useMapStore((s) => s.setHeatmapMode);

  const [mode, setMode] = useState<HeatmapMode>('clients');
  const highlightedCommune = searchParams.get('comuna');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['territory'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TerritoryAnalysis> => {
      const response = await fetch('/api/territorio');
      if (!response.ok) throw new Error('No fue posible cargar el analisis territorial.');
      return (await response.json()) as TerritoryAnalysis;
    },
  });

  const communes = useMemo(() => data?.communes ?? [], [data]);

  const maxClients = useMemo(
    () => Math.max(1, ...communes.map((c) => c.totalClients)),
    [communes],
  );

  const weakCoverage = useMemo(
    () =>
      [...communes]
        .filter((c) => c.totalClients > 0)
        .sort((a, b) => a.coverageRatio - b.coverageRatio)
        .slice(0, 6),
    [communes],
  );

  const noPresence = useMemo(() => communes.filter((c) => c.totalClients === 0), [communes]);

  if (isError) {
    return (
      <>
        <PageHeader title="Inteligencia territorial" />
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
        <PageHeader title="Inteligencia territorial" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-80 w-full" />
          <SkeletonRows rows={6} />
        </div>
      </>
    );
  }

  const { totals } = data;

  return (
    <>
      <PageHeader
        title="Inteligencia territorial"
        description="Distribucion de la cartera, cobertura comercial y concentracion geografica a partir de los datos disponibles."
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<Flame className="h-3.5 w-3.5" />}
            onClick={() => {
              setLayer('calor', true);
              setLayer('clientes', false);
              setHeatmapMode(mode);
              router.push('/control');
            }}
          >
            Abrir calor en el mapa operacional
          </Button>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Clientes totales" value={formatNumber(totals.clients)} />
            <Stat label="Activos" value={formatNumber(totals.active)} tone="active" />
            <Stat label="En observacion" value={formatNumber(totals.warning)} tone="warning" />
            <Stat label="Dormidos" value={formatNumber(totals.dormant)} tone="danger" />
            <Stat label="Comunas con presencia" value={formatNumber(totals.communesCovered)} tone="brand" />
            <Stat
              label="Comunas sin presencia"
              value={formatNumber(totals.communesWithoutPresence)}
              tone={totals.communesWithoutPresence > 0 ? 'warning' : 'neutral'}
            />
          </CardBody>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Card className="overflow-hidden">
            <CardHeader
              title="Mapa de calor"
              description="Concentracion geografica segun el modo seleccionado"
              icon={<Flame className="h-4 w-4" />}
              action={
                <Select
                  value={mode}
                  onChange={(event) => setMode(event.target.value as HeatmapMode)}
                  options={HEATMAP_OPTIONS}
                  className="w-56"
                  aria-label="Modo del mapa de calor"
                />
              }
            />
            <div className="relative h-[400px] sm:h-[520px]">
              <ErrorBoundary section="el mapa de calor territorial">
                <TerritoryHeatmap analysis={data} mode={mode} />
              </ErrorBoundary>
            </div>
            <CardBody className="border-t border-line">
              <p className="text-2xs leading-relaxed text-ink-faint">
                {mode === 'clients'
                  ? 'Los puntos se ponderan por valor acumulado del cliente: el calor muestra donde esta el negocio, no solo donde hay direcciones.'
                  : mode === 'dormant'
                    ? 'Los puntos se ponderan por antiguedad sin compra: las zonas mas intensas concentran la mayor perdida de actividad.'
                    : mode === 'orders'
                      ? 'Pedidos registrados en los ultimos 30 dias, ubicados en la direccion de despacho del cliente.'
                      : 'Visitas detectadas por geocerca, ubicadas en el domicilio del cliente.'}
              </p>
            </CardBody>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader
                title="Cobertura mas debil"
                description="Comunas con menor proporcion de clientes activos"
                icon={<TrendingDown className="h-4 w-4" />}
              />
              <CardBody className="space-y-3">
                {weakCoverage.map((commune) => (
                  <div key={commune.communeCode}>
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          focusOn(commune.center, 12.5);
                          router.push('/control');
                        }}
                        className="flex min-h-11 min-w-11 items-center truncate text-left text-[13px] text-ink hover:text-brand-700 sm:block sm:min-h-0 sm:min-w-0"
                      >
                        {commune.communeName}
                      </button>
                      <span className="numeric shrink-0 text-2xs text-ink-faint">
                        {formatPercent(commune.coverageRatio)} activos
                      </span>
                    </div>
                    <ProgressBar
                      value={commune.coverageRatio}
                      size="sm"
                      tone={
                        commune.coverageRatio < 0.4
                          ? 'warning'
                          : commune.coverageRatio < 0.6
                            ? 'brand'
                            : 'active'
                      }
                    />
                    <p className="numeric mt-1 text-2xs text-ink-faint">
                      {commune.totalClients} clientes · {commune.dormantClients} dormidos ·{' '}
                      {commune.ordersLast30Days} pedidos (30 d)
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Sectores sin presencia"
                description="Comunas del area operacional sin cartera registrada"
                icon={<MapPin className="h-4 w-4" />}
              />
              <CardBody>
                {noPresence.length === 0 ? (
                  <EmptyState
                    compact
                    icon={<MapPin className="h-5 w-5" />}
                    title="Cobertura completa del area operacional"
                    description="Todas las comunas del area analizada tienen al menos un cliente registrado."
                  />
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {noPresence.map((commune) => (
                      <li key={commune.communeCode}>
                        <button
                          type="button"
                          onClick={() => {
                            focusOn(commune.center, 12.5);
                            router.push('/control');
                          }}
                          className="flex min-h-11 items-center rounded-md border border-status-warning/30 bg-status-warning/10 px-3 text-xs text-status-warning transition-colors hover:border-status-warning/60 sm:min-h-0 sm:px-2.5 sm:py-1.5"
                        >
                          {commune.communeName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        <Card className="overflow-hidden">
          <CardHeader
            title="Distribucion por comuna"
            description="Composicion de la cartera y actividad reciente"
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                      Comuna
                    </th>
                    <th className="px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                      Distribucion
                    </th>
                    <th className="px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                      Total
                    </th>
                    <th className="hidden px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint sm:table-cell">
                      Activos
                    </th>
                    <th className="hidden px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint sm:table-cell">
                      Observacion
                    </th>
                    <th className="px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                      Dormidos
                    </th>
                    <th className="hidden px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint lg:table-cell">
                      Pedidos 30 d
                    </th>
                    <th className="hidden px-3 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint lg:table-cell">
                      Visitas 30 d
                    </th>
                    <th className="px-4 py-2.5 text-right text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                      Cobertura
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {communes.map((commune) => (
                    <tr
                      key={commune.communeCode}
                      className={cn(
                        'transition-colors hover:bg-surface-800',
                        highlightedCommune === commune.communeCode && 'bg-brand-500/8',
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => {
                            focusOn(commune.center, 12.5);
                            router.push('/control');
                          }}
                          className="flex min-h-11 min-w-11 items-center text-left text-[13px] text-ink hover:text-brand-700 sm:block sm:min-h-0 sm:min-w-0"
                        >
                          {commune.communeName}
                        </button>
                      </td>

                      <td className="px-3 py-2.5">
                        {/* Barra apilada: composicion de la cartera de un vistazo. */}
                        <div className="flex h-2 w-28 overflow-hidden rounded-full bg-surface-750 sm:w-40">
                          <div
                            className="bg-status-active"
                            style={{
                              width: `${commune.totalClients === 0 ? 0 : (commune.activeClients / maxClients) * 100}%`,
                            }}
                          />
                          <div
                            className="bg-status-warning"
                            style={{
                              width: `${commune.totalClients === 0 ? 0 : (commune.warningClients / maxClients) * 100}%`,
                            }}
                          />
                          <div
                            className="bg-status-dormant"
                            style={{
                              width: `${commune.totalClients === 0 ? 0 : (commune.dormantClients / maxClients) * 100}%`,
                            }}
                          />
                        </div>
                      </td>

                      <td className="numeric px-3 py-2.5 text-right text-[13px] text-ink">
                        {commune.totalClients}
                      </td>
                      <td className="numeric hidden px-3 py-2.5 text-right text-[13px] text-status-active sm:table-cell">
                        {commune.activeClients}
                      </td>
                      <td className="numeric hidden px-3 py-2.5 text-right text-[13px] text-status-warning sm:table-cell">
                        {commune.warningClients}
                      </td>
                      <td className="numeric px-3 py-2.5 text-right text-[13px] text-status-dormant">
                        {commune.dormantClients}
                      </td>
                      <td className="numeric hidden px-3 py-2.5 text-right text-[13px] text-ink-muted lg:table-cell">
                        {commune.ordersLast30Days}
                      </td>
                      <td className="numeric hidden px-3 py-2.5 text-right text-[13px] text-ink-muted lg:table-cell">
                        {commune.visitsLast30Days}
                      </td>
                      <td className="numeric px-4 py-2.5 text-right text-[13px]">
                        <span
                          className={cn(
                            commune.totalClients === 0
                              ? 'text-ink-faint'
                              : commune.coverageRatio >= 0.6
                                ? 'text-status-active'
                                : commune.coverageRatio >= 0.4
                                  ? 'text-status-warning'
                                  : 'text-status-dormant',
                          )}
                        >
                          {commune.totalClients === 0 ? '--' : formatPercent(commune.coverageRatio)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

/** Mapa dedicado del analisis territorial, con la capa de calor activa. */
function TerritoryHeatmap({ analysis, mode }: { analysis: TerritoryAnalysis; mode: HeatmapMode }) {
  return (
    <FleetMap
      className="absolute inset-0"
      // Este mapa tiene un proposito fijo: calor y comunas, sin depender de lo
      // que el usuario haya activado en el mapa operacional.
      layerOverride={{
        calor: true,
        comunas: true,
        camiones: false,
        clientes: false,
        rutas: false,
        geocercas: false,
        pedidos: false,
        alertas: false,
      }}
      vehicles={[]}
      clients={[]}
      routes={[]}
      geofences={[]}
      alerts={[]}
      workOrders={[]}
      communes={analysis.communes.map((c) => ({
        code: c.communeCode,
        name: c.communeName,
        center: c.center,
        boundary: [],
      }))}
      heatmapPoints={analysis.heatmaps[mode]}
    />
  );
}
