'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  Check,
  ClipboardList,
  Eye,
  MapPin,
  RotateCcw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { SEVERITY_LABEL, SeverityBadge } from '@/components/common/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { formatSmartDateTime, normalizeSearch } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { Alert, AlertCategory, AlertSeverity, AlertState } from '@/types/core';

const CATEGORY_LABEL: Record<AlertCategory, string> = {
  gps: 'GPS',
  ruta: 'Ruta',
  geocerca: 'Geocerca',
  cliente: 'Clientes',
  operacion: 'Operacion',
};

const SEVERITY_OPTIONS = [
  { value: '', label: 'Todas las severidades' },
  { value: 'critical', label: SEVERITY_LABEL.critical },
  { value: 'warning', label: SEVERITY_LABEL.warning },
  { value: 'info', label: SEVERITY_LABEL.info },
];

const CATEGORY_OPTIONS = [
  { value: '', label: 'Todas las categorias' },
  ...(Object.keys(CATEGORY_LABEL) as AlertCategory[]).map((key) => ({
    value: key,
    label: CATEGORY_LABEL[key],
  })),
];

const STATE_OPTIONS = [
  { value: 'abiertas', label: 'Sin resolver' },
  { value: 'nueva', label: 'Nuevas' },
  { value: 'revisada', label: 'Revisadas' },
  { value: 'resuelta', label: 'Resueltas' },
  { value: '', label: 'Todas' },
];

/**
 * Centro de alertas. Cada alerta proviene de una regla evaluada sobre la
 * telemetria y la operacion, no de una lista fija.
 */
export function AlertsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);

  const [search, setSearch] = useState('');
  const [severity, setSeverity] = useState(searchParams.get('severidad') ?? '');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('abiertas');
  const highlightedId = searchParams.get('alerta');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['alerts'],
    refetchInterval: 45_000,
    queryFn: async (): Promise<{ alerts: Alert[] }> => {
      const response = await fetch('/api/alertas');
      if (!response.ok) throw new Error('No fue posible cargar las alertas.');
      return (await response.json()) as { alerts: Alert[] };
    },
  });

  const updateState = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: AlertState }): Promise<Alert> => {
      const response = await fetch(`/api/alertas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: next }),
      });
      if (!response.ok) throw new Error('No fue posible actualizar la alerta.');
      return (await response.json()) as Alert;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts', 'summary'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const alerts = useMemo(() => data?.alerts ?? [], [data]);

  const rows = useMemo(() => {
    const term = normalizeSearch(search);

    return alerts.filter((alert) => {
      if (severity && alert.severity !== severity) return false;
      if (category && alert.category !== category) return false;
      if (state === 'abiertas' && alert.state === 'resuelta') return false;
      if (state && state !== 'abiertas' && alert.state !== state) return false;
      if (term.length === 0) return true;

      return normalizeSearch(
        `${alert.title} ${alert.description} ${alert.vehiclePlate ?? ''} ${alert.clientName ?? ''} ${alert.workOrderNumber ?? ''}`,
      ).includes(term);
    });
  }, [alerts, search, severity, category, state]);

  const counts = useMemo(() => {
    const open = alerts.filter((a) => a.state !== 'resuelta');
    const result: Record<AlertSeverity, number> = { critical: 0, warning: 0, info: 0 };
    for (const alert of open) result[alert.severity] += 1;
    return result;
  }, [alerts]);

  const hasFilters = Boolean(search || severity || category || state !== 'abiertas');

  const clearFilters = (): void => {
    setSearch('');
    setSeverity('');
    setCategory('');
    setState('abiertas');
    router.replace('/alertas');
  };

  return (
    <>
      <PageHeader
        title="Centro de alertas"
        description="Incidencias detectadas por los motores de GPS, ruta, geocerca y operacion."
      />

      <div className="mb-4 grid grid-cols-3 gap-2.5 sm:gap-3">
        {(['critical', 'warning', 'info'] as AlertSeverity[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSeverity(severity === key ? '' : key)}
            className={cn(
              'rounded-lg border p-3 text-left transition-colors sm:p-4',
              severity === key
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-line bg-surface-850 hover:border-line-strong',
            )}
          >
            <p className="text-2xs font-medium uppercase tracking-wider text-ink-faint">
              {SEVERITY_LABEL[key]}
            </p>
            <p
              className={cn(
                'numeric mt-1.5 text-2xl font-semibold leading-none',
                key === 'critical'
                  ? 'text-status-dormant'
                  : key === 'warning'
                    ? 'text-status-warning'
                    : 'text-brand-700',
              )}
            >
              {counts[key]}
            </p>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="grid gap-2.5 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Buscar por patente, cliente, OT o texto"
          />
          <Select
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            options={SEVERITY_OPTIONS}
            aria-label="Filtrar por severidad"
          />
          <Select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            options={CATEGORY_OPTIONS}
            aria-label="Filtrar por categoria"
          />
          <Select
            value={state}
            onChange={(event) => setState(event.target.value)}
            options={STATE_OPTIONS}
            aria-label="Filtrar por estado"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
          <p className="text-xs text-ink-faint">
            <span className="numeric font-medium text-ink">{rows.length}</span> de{' '}
            <span className="numeric">{alerts.length}</span> alertas visibles
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
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck className="h-5 w-5" />}
            title="No hay alertas que coincidan con los filtros seleccionados."
            description="La operacion se encuentra dentro de los parametros configurados, o los filtros son demasiado restrictivos."
            action={
              hasFilters ? (
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((alert) => (
              <li
                key={alert.id}
                className={cn(
                  'p-4 transition-colors',
                  alert.id === highlightedId && 'bg-brand-500/8 ring-1 ring-inset ring-brand-500/30',
                  alert.state === 'resuelta' && 'opacity-60',
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={alert.severity} />
                      <Badge tone="neutral">{CATEGORY_LABEL[alert.category]}</Badge>
                      {alert.state !== 'nueva' ? (
                        <Badge tone={alert.state === 'resuelta' ? 'active' : 'brand'}>
                          {alert.state === 'resuelta' ? 'Resuelta' : 'Revisada'}
                        </Badge>
                      ) : null}
                      <span className="numeric text-2xs text-ink-faint">
                        {formatSmartDateTime(alert.timestamp)}
                      </span>
                    </div>

                    <p className="mt-1.5 text-[13px] font-medium text-ink">{alert.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                      {alert.description}
                    </p>

                    {/*
                      Referencias a las entidades implicadas. Se presentan como
                      fichas tocables y no como texto subrayado: un enlace
                      inline de 16 px de alto es inalcanzable con el pulgar en
                      una lista densa.
                    */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {alert.vehiclePlate && alert.vehicleId ? (
                        <EntityLink
                          href={`/flota/${alert.vehicleId}`}
                          icon={<Truck className="h-3 w-3" />}
                          label={alert.vehiclePlate}
                        />
                      ) : null}
                      {alert.clientName && alert.clientId ? (
                        <EntityLink
                          href={`/clientes/${alert.clientId}`}
                          icon={<Building2 className="h-3 w-3" />}
                          label={alert.clientName}
                        />
                      ) : null}
                      {alert.workOrderNumber && alert.workOrderId ? (
                        <EntityLink
                          href={`/ordenes/${alert.workOrderId}`}
                          icon={<ClipboardList className="h-3 w-3" />}
                          label={alert.workOrderNumber}
                          numeric
                        />
                      ) : null}
                    </div>

                    {alert.metadata ? (
                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(alert.metadata).map(([key, value]) => (
                          <div key={key} className="flex items-baseline gap-1.5">
                            <dt className="text-2xs text-ink-faint first-letter:uppercase">
                              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}:
                            </dt>
                            <dd className="numeric text-2xs text-ink-muted">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {alert.position ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<MapPin className="h-3.5 w-3.5" />}
                        onClick={() => {
                          if (alert.vehicleId) select({ type: 'vehicle', id: alert.vehicleId });
                          else if (alert.clientId) select({ type: 'client', id: alert.clientId });
                          focusOn(alert.position!, 15);
                          router.push('/mapa');
                        }}
                      >
                        Abrir en mapa
                      </Button>
                    ) : null}

                    {alert.state === 'nueva' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Eye className="h-3.5 w-3.5" />}
                        loading={updateState.isPending && updateState.variables?.id === alert.id}
                        onClick={() => updateState.mutate({ id: alert.id, next: 'revisada' })}
                      >
                        Marcar revisada
                      </Button>
                    ) : null}

                    {alert.state !== 'resuelta' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Check className="h-3.5 w-3.5" />}
                        loading={updateState.isPending && updateState.variables?.id === alert.id}
                        onClick={() => updateState.mutate({ id: alert.id, next: 'resuelta' })}
                      >
                        Resolver
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<AlertTriangle className="h-3.5 w-3.5" />}
                        onClick={() => updateState.mutate({ id: alert.id, next: 'nueva' })}
                      >
                        Reabrir
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/**
 * Referencia tocable a una entidad implicada en la alerta.
 *
 * Alto minimo de 32 px en movil: no llega a los 44 px de un control primario
 * porque es una referencia secundaria dentro de una lista densa, pero si es
 * un objetivo alcanzable con el pulgar, cosa que un enlace de texto no era.
 */
function EntityLink({
  href,
  icon,
  label,
  numeric,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  numeric?: boolean;
}) {
  return (
    <Link
      prefetch={false}
      href={href}
      className={cn(
        'inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-800 px-2.5 py-1 text-2xs text-brand-700 transition-colors hover:border-brand-500 hover:bg-surface-750 sm:min-h-0 sm:px-2 sm:py-0.5',
        numeric && 'numeric',
      )}
    >
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
