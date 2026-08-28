'use client';

import { Filter, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NumberField, SearchInput, Select } from '@/components/ui/input';
import { CLIENT_STATUS_LABEL } from '@/lib/engines/client-activity';
import { cn } from '@/lib/cn';
import { DEFAULT_CLIENT_FILTERS, useMapStore } from '@/stores/map-store';
import type { ClientActivityStatus } from '@/types/core';
import type { ClientMapPoint } from '@/types/views';

const STATUS_ORDER: ClientActivityStatus[] = ['active', 'warning', 'dormant'];

const STATUS_STYLE: Record<ClientActivityStatus, string> = {
  active: 'border-status-active/40 bg-status-active/15 text-status-active',
  warning: 'border-status-warning/40 bg-status-warning/15 text-status-warning',
  dormant: 'border-status-dormant/40 bg-status-dormant/15 text-status-dormant',
};

export interface ClientFiltersPanelProps {
  /** Universo de clientes, para poblar comunas y contar coincidencias. */
  allClients: ClientMapPoint[];
  visibleCount: number;
  totalCount: number;
}

/**
 * Panel de filtros de clientes.
 *
 * Todos los filtros exigidos por la operacion comercial: estado, comuna,
 * nombre o codigo, antiguedad de compra y de visita, presencia de pedido y
 * visitas del dia. Siempre muestra cuantos clientes quedan visibles.
 */
export function ClientFiltersPanel({ allClients, visibleCount, totalCount }: ClientFiltersPanelProps) {
  const filters = useMapStore((s) => s.filters);
  const setFilters = useMapStore((s) => s.setFilters);
  const resetFilters = useMapStore((s) => s.resetFilters);
  const activeFilterCount = useMapStore((s) => s.activeFilterCount());

  const communes = useMemo(() => {
    const map = new Map<string, { code: string; name: string; count: number }>();
    for (const client of allClients) {
      const entry = map.get(client.communeCode) ?? {
        code: client.communeCode,
        name: client.communeName,
        count: 0,
      };
      entry.count += 1;
      map.set(client.communeCode, entry);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [allClients]);

  const statusCounts = useMemo(() => {
    const counts: Record<ClientActivityStatus, number> = { active: 0, warning: 0, dormant: 0 };
    for (const client of allClients) counts[client.status] += 1;
    return counts;
  }, [allClients]);

  const toggleStatus = (status: ClientActivityStatus): void => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    // Quedarse sin estados vaciaria el mapa sin motivo: se restablecen todos.
    setFilters({ statuses: next.length === 0 ? STATUS_ORDER : next });
  };

  const toggleCommune = (code: string): void => {
    const next = filters.communeCodes.includes(code)
      ? filters.communeCodes.filter((c) => c !== code)
      : [...filters.communeCodes, code];
    setFilters({ communeCodes: next });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Filter className="h-4 w-4 text-brand-700" />
          Filtros de clientes
          {activeFilterCount > 0 ? <Badge tone="brand">{activeFilterCount}</Badge> : null}
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          onClick={resetFilters}
          disabled={activeFilterCount === 0}
        >
          Limpiar filtros
        </Button>
      </div>

      {/* Recuento de visibles: la operacion necesita saber cuanto esta ocultando. */}
      <p className="rounded-md border border-line bg-surface-800 px-3 py-2 text-xs text-ink">
        <span className="numeric font-semibold text-brand-700">{visibleCount}</span> de{' '}
        <span className="numeric font-semibold">{totalCount}</span> clientes visibles
      </p>

      <div>
        <label className="field-label">Estado comercial</label>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_ORDER.map((status) => {
            const selected = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                aria-pressed={selected}
                className={cn(
                  'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
                  selected
                    ? STATUS_STYLE[status]
                    : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-muted',
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {CLIENT_STATUS_LABEL[status]}
                <span className="numeric opacity-70">{statusCounts[status]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="field-label" htmlFor="filtro-busqueda">
          Nombre, codigo o direccion
        </label>
        <SearchInput
          id="filtro-busqueda"
          value={filters.search}
          onChange={(event) => setFilters({ search: event.target.value })}
          onClear={() => setFilters({ search: '' })}
          placeholder="Ej: Minimarket Andina, F10231, Av. Grecia"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="filtro-pedido">
            Pedidos
          </label>
          <Select
            id="filtro-pedido"
            value={filters.orderState}
            onChange={(event) =>
              setFilters({ orderState: event.target.value as typeof filters.orderState })
            }
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'con_pedido', label: 'Con pedido pendiente' },
              { value: 'sin_pedido', label: 'Sin pedido' },
            ]}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="filtro-visita">
            Visitas
          </label>
          <Select
            id="filtro-visita"
            value={filters.visitState}
            onChange={(event) =>
              setFilters({ visitState: event.target.value as typeof filters.visitState })
            }
            options={[
              { value: 'todos', label: 'Todas' },
              { value: 'visitados_hoy', label: 'Visitados hoy' },
              { value: 'no_visitados', label: 'No visitados hoy' },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="Dias sin comprar (min)"
          suffix="dias"
          min={0}
          value={filters.minDaysSincePurchase ?? ''}
          onChange={(event) =>
            setFilters({
              minDaysSincePurchase: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          placeholder="Sin limite"
        />
        <NumberField
          label="Dias sin comprar (max)"
          suffix="dias"
          min={0}
          value={filters.maxDaysSincePurchase ?? ''}
          onChange={(event) =>
            setFilters({
              maxDaysSincePurchase: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          placeholder="Sin limite"
        />
      </div>

      <NumberField
        label="Dias sin visita (max)"
        hint="Util para detectar clientes que compran pero no reciben visita comercial."
        suffix="dias"
        min={0}
        value={filters.maxDaysSinceVisit ?? ''}
        onChange={(event) =>
          setFilters({
            maxDaysSinceVisit: event.target.value === '' ? null : Number(event.target.value),
          })
        }
        placeholder="Sin limite"
      />

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="field-label mb-0">Comuna / sector</label>
          {filters.communeCodes.length > 0 ? (
            <button
              type="button"
              onClick={() => setFilters({ communeCodes: [] })}
              className="inline-flex min-h-11 items-center text-2xs text-brand-700 hover:underline sm:min-h-0"
            >
              Quitar {filters.communeCodes.length}
            </button>
          ) : null}
        </div>

        <div className="max-h-52 space-y-0.5 overflow-y-auto rounded-md border border-line bg-surface-900 p-1">
          {communes.map((commune) => {
            const selected = filters.communeCodes.includes(commune.code);
            return (
              <button
                key={commune.code}
                type="button"
                onClick={() => toggleCommune(commune.code)}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                  selected ? 'bg-brand-500/15 text-brand-700' : 'text-ink-muted hover:bg-surface-800',
                )}
              >
                <span className="truncate">{commune.name}</span>
                <span className="numeric shrink-0 text-2xs text-ink-faint">{commune.count}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Aplica los filtros a la lista de clientes.
 *
 * Vive junto al panel para que agregar un filtro signifique tocar un solo
 * archivo: el control y su semantica se mantienen sincronizados.
 */
export function applyClientFilters(
  clients: ClientMapPoint[],
  filters: typeof DEFAULT_CLIENT_FILTERS,
): ClientMapPoint[] {
  const term = filters.search.trim().toLowerCase();

  return clients.filter((client) => {
    if (!filters.statuses.includes(client.status)) return false;
    if (filters.communeCodes.length > 0 && !filters.communeCodes.includes(client.communeCode)) {
      return false;
    }

    if (term.length > 0) {
      const haystack = `${client.name} ${client.code} ${client.addressLine} ${client.communeName}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }

    if (filters.orderState === 'con_pedido' && !client.hasPendingOrder) return false;
    if (filters.orderState === 'sin_pedido' && client.hasPendingOrder) return false;

    if (filters.visitState === 'visitados_hoy' && !client.visitedToday) return false;
    if (filters.visitState === 'no_visitados' && client.visitedToday) return false;

    const days = client.daysSincePurchase;
    if (filters.minDaysSincePurchase !== null) {
      // Un cliente sin compra registrada supera cualquier minimo exigido.
      if (days !== null && days < filters.minDaysSincePurchase) return false;
    }
    if (filters.maxDaysSincePurchase !== null) {
      if (days === null || days > filters.maxDaysSincePurchase) return false;
    }
    if (filters.maxDaysSinceVisit !== null) {
      if (client.daysSinceVisit === null || client.daysSinceVisit > filters.maxDaysSinceVisit) {
        return false;
      }
    }

    return true;
  });
}
