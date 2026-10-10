'use client';

import { Building2, Car, Check, ChevronDown, ChevronRight, Fuel, MapPin, RotateCcw, Truck, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NumberField, SearchInput, Select } from '@/components/ui/input';
import { CLIENT_STATUS_LABEL } from '@/lib/engines/client-activity';
import { cn } from '@/lib/cn';
import { normalizeSearch } from '@/lib/format';
import { DEFAULT_CLIENT_FILTERS, useMapStore } from '@/stores/map-store';
import { matchesVehicleGroup, VEHICLE_GROUP_FILTER_OPTIONS, type VehicleGroupFilter } from '@/lib/vehicle-groups';
import type { ClientActivityStatus, VehicleSnapshot } from '@/types/core';
import type { ClientMapPoint } from '@/types/views';

const STATUS_ORDER: ClientActivityStatus[] = ['active', 'warning', 'dormant'];
const STATUS_STYLE: Record<ClientActivityStatus, string> = {
  active: 'border-status-active/30 bg-status-active/10 text-status-active',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  dormant: 'border-status-dormant/30 bg-status-dormant/10 text-status-dormant',
};
const TABS = [{ id: 'vehicles', label: 'Vehículos', icon: Truck }, { id: 'clients', label: 'Clientes', icon: Users }, { id: 'territory', label: 'Territorio', icon: MapPin }] as const;

export interface ClientFiltersPanelProps {
  allClients: ClientMapPoint[];
  visibleCount: number;
  totalCount: number;
  vehicles?: VehicleSnapshot[];
}

export function MapFiltersFooter({ onClose, visibleVehicles, totalVehicles, visibleClients, totalClients }: {
  onClose: () => void; visibleVehicles: number; totalVehicles: number; visibleClients: number; totalClients: number;
}) {
  const count = useMapStore(s => s.activeFilterCount());
  const reset = useMapStore(s => s.resetFilters);
  return <div className="space-y-2 p-3">
    <div className="flex items-center justify-between text-2xs text-ink-muted" role="status">
      <span><strong className="numeric text-ink">{visibleVehicles}</strong> de {totalVehicles} {totalVehicles === 1 ? 'vehículo' : 'vehículos'}</span>
      {totalClients > 0 ? <span><strong className="numeric text-ink">{visibleClients}</strong> de {totalClients} clientes</span> : <span>{count === 0 ? 'Sin filtros activos' : `${count} ${count === 1 ? 'filtro activo' : 'filtros activos'}`}</span>}
    </div>
    <div className="grid grid-cols-[1fr_1.2fr] gap-2">
      <Button variant="secondary" size="sm" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={count === 0} onClick={reset}>Restablecer</Button>
      <Button variant="primary" size="sm" onClick={onClose} icon={<ChevronRight className="h-4 w-4" />}>Ver mapa</Button>
    </div>
  </div>;
}

/** Controles agrupados por tarea; la semántica de cada filtro se conserva. */
export function ClientFiltersPanel({ allClients, visibleCount, totalCount, vehicles = [] }: ClientFiltersPanelProps) {
  const filters = useMapStore(s => s.filters);
  const setFilters = useMapStore(s => s.setFilters);
  const group = useMapStore(s => s.vehicleGroupFilter);
  const setGroup = useMapStore(s => s.setVehicleGroupFilter);
  const [tab, setTab] = useState<typeof TABS[number]['id']>('vehicles');
  const [communeSearch, setCommuneSearch] = useState('');
  const communes = useMemo(() => {
    const entries = new Map<string, { code: string; name: string; count: number }>();
    for (const client of allClients) {
      const entry = entries.get(client.communeCode) ?? { code: client.communeCode, name: client.communeName, count: 0 };
      entry.count++; entries.set(entry.code, entry);
    }
    return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [allClients]);
  const statusCounts = useMemo(() => {
    const counts = { active: 0, warning: 0, dormant: 0 };
    allClients.forEach(client => counts[client.status]++); return counts;
  }, [allClients]);
  const groupCount = (value: VehicleGroupFilter) => vehicles.filter(v => matchesVehicleGroup(v.vehicle, value)).length;
  const toggleStatus = (status: ClientActivityStatus) => {
    const next = filters.statuses.includes(status) ? filters.statuses.filter(s => s !== status) : [...filters.statuses, status];
    setFilters({ statuses: next.length ? next : STATUS_ORDER });
  };
  const toggleCommune = (code: string) => setFilters({ communeCodes: filters.communeCodes.includes(code) ? filters.communeCodes.filter(c => c !== code) : [...filters.communeCodes, code] });
  const chips: { id: string; label: string; clear: () => void }[] = [];
  if (group !== 'todos') chips.push({ id: 'group', label: VEHICLE_GROUP_FILTER_OPTIONS.find(o => o.value === group)!.label, clear: () => setGroup('todos') });
  if (filters.statuses.length !== 3) chips.push({ id: 'statuses', label: filters.statuses.map(s => CLIENT_STATUS_LABEL[s]).join(', '), clear: () => setFilters({ statuses: STATUS_ORDER }) });
  if (filters.search.trim()) chips.push({ id: 'search', label: `Buscar: ${filters.search.trim()}`, clear: () => setFilters({ search: '' }) });
  if (filters.orderState !== 'todos') chips.push({ id: 'order', label: filters.orderState === 'con_pedido' ? 'Con pedido pendiente' : 'Sin pedido', clear: () => setFilters({ orderState: 'todos' }) });
  if (filters.visitState !== 'todos') chips.push({ id: 'visit', label: filters.visitState === 'visitados_hoy' ? 'Visitados hoy' : 'Sin visita hoy', clear: () => setFilters({ visitState: 'todos' }) });
  if (filters.minDaysSincePurchase !== null || filters.maxDaysSincePurchase !== null) chips.push({ id: 'purchase', label: 'Antigüedad de compra', clear: () => setFilters({ minDaysSincePurchase: null, maxDaysSincePurchase: null }) });
  if (filters.maxDaysSinceVisit !== null) chips.push({ id: 'visitDays', label: `Visita: hasta ${filters.maxDaysSinceVisit} días`, clear: () => setFilters({ maxDaysSinceVisit: null }) });
  if (filters.communeCodes.length) chips.push({ id: 'communes', label: `${filters.communeCodes.length} ${filters.communeCodes.length === 1 ? 'comuna' : 'comunas'}`, clear: () => setFilters({ communeCodes: [] }) });
  const shownCommunes = communes.filter(c => normalizeSearch(c.name).includes(normalizeSearch(communeSearch)));
  const visibleChips = chips.filter(chip => tab !== 'vehicles' || chip.id !== 'group');

  return <div>
    <nav aria-label="Secciones de filtros" className="sticky top-0 z-10 border-b border-line bg-surface-900 px-3 py-2">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-800 p-1">
        {TABS.map(item => <button key={item.id} type="button" aria-pressed={tab === item.id} onClick={() => setTab(item.id)}
          className={cn('flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500', tab === item.id ? 'bg-surface-900 text-brand-700 shadow-card' : 'text-ink-muted hover:text-ink')}>
          <item.icon className="h-3.5 w-3.5 shrink-0" />{item.label}
        </button>)}
      </div>
    </nav>
    <div className="space-y-4 p-3">
      {visibleChips.length > 0 ? <div aria-label="Filtros activos" className="flex flex-wrap gap-1.5">
        {visibleChips.map(chip => <button key={chip.id} type="button" onClick={chip.clear} aria-label={`Quitar filtro: ${chip.label}`} title={chip.label}
          className="flex max-w-full items-center gap-1.5 rounded-full border border-brand-500/20 bg-brand-500/10 py-1.5 pl-2.5 pr-2 text-2xs text-brand-700 hover:bg-brand-500/20">
          <span className="max-w-[230px] truncate">{chip.label}</span><X className="h-3 w-3 shrink-0" />
        </button>)}
      </div> : null}
      {tab === 'vehicles' ? <section aria-label="Filtros de vehículos" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div><h3 className="text-[13px] font-semibold text-ink">Agrupación de flota</h3><p className="mt-0.5 text-2xs text-ink-muted">Elige qué vehículos mostrar.</p></div>
          <button type="button" aria-pressed={group === 'todos'} onClick={() => setGroup('todos')} className={cn('flex min-h-9 items-center gap-1 rounded-full px-2.5 text-xs font-medium', group === 'todos' ? 'bg-brand-500/10 text-brand-700' : 'text-ink-muted hover:bg-surface-800')}>
            {group === 'todos' ? <Check className="h-3 w-3" /> : null}Todos <span className="numeric text-2xs opacity-70">{vehicles.length}</span>
          </button>
        </div>
        <button type="button" aria-pressed={group === 'carga'} onClick={() => setGroup('carga')}
          className={cn('flex min-h-16 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors', group === 'carga' ? 'border-brand-500 bg-brand-500/10 ring-1 ring-brand-500/10' : 'border-line bg-surface-800 hover:border-brand-500/40')}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700"><Fuel className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-ink">Carga de combustible</span><span className="mt-1 block text-2xs text-ink-muted">Camiones y camionetas juntos</span></span>
          <span className="numeric rounded-lg bg-surface-900 px-2.5 py-1 text-xs font-semibold text-brand-700">{groupCount('carga')}</span>
        </button>
        <div className="grid grid-cols-3 gap-2">
          {[{ id: 'camiones', label: 'Camiones', icon: Truck }, { id: 'camionetas', label: 'Camionetas', icon: Truck }, { id: 'personal', label: 'Personal', icon: Car }].map(item => <button key={item.id} type="button" aria-pressed={group === item.id} onClick={() => setGroup(item.id as VehicleGroupFilter)}
            className={cn('flex min-h-[76px] min-w-0 flex-col items-start gap-1.5 rounded-xl border p-2.5 text-left transition-colors', group === item.id ? 'border-brand-500 bg-brand-500/10 text-brand-700' : 'border-line bg-surface-900 text-ink-muted hover:border-brand-500/40')}>
            <span className="flex w-full items-center justify-between gap-1"><item.icon className="h-4 w-4" /><span className="numeric text-xs font-semibold">{groupCount(item.id as VehicleGroupFilter)}</span></span>
            <span className="text-[11px] font-medium sm:text-xs">{item.label}</span>
            {group === item.id ? <Check className="h-3 w-3" /> : <span className="h-3" />}
          </button>)}
        </div>
        {groupCount('sin_grupo') > 0 || group === 'sin_grupo' ? <button type="button" aria-pressed={group === 'sin_grupo'} onClick={() => setGroup('sin_grupo')} className="flex w-full items-center justify-between rounded-lg border border-dashed border-line-strong px-3 py-2 text-xs text-ink-muted"><span>Sin grupo asignado</span><span className="numeric">{groupCount('sin_grupo')}</span></button> : null}
      </section> : null}
      {tab === 'clients' ? <section aria-label="Filtros de clientes" className="space-y-4">
        <div><h3 className="text-[13px] font-semibold text-ink">Clientes en el mapa</h3><p className="mt-0.5 text-2xs text-ink-muted">{visibleCount} de {totalCount} coinciden con tu selección.</p></div>
        {totalCount === 0 ? <FilterEmpty icon={Building2} title="Aún no hay clientes registrados" description="Los filtros de estado, pedidos y actividad estarán disponibles cuando incorpores tu cartera." /> : <>
          <SearchInput aria-label="Buscar clientes en el mapa" value={filters.search} onChange={e => setFilters({ search: e.target.value })} onClear={() => setFilters({ search: '' })} placeholder="Nombre, código o dirección" className="sm:h-10" />
          <div><p className="field-label">Estado comercial</p><div className="flex flex-wrap gap-2">{STATUS_ORDER.map(status => <button key={status} type="button" aria-pressed={filters.statuses.includes(status)} onClick={() => toggleStatus(status)} className={cn('flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-2xs', filters.statuses.includes(status) ? STATUS_STYLE[status] : 'border-line text-ink-muted')}><span className="h-1.5 w-1.5 rounded-full bg-current" />{CLIENT_STATUS_LABEL[status]}<span className="numeric opacity-70">{statusCounts[status]}</span></button>)}</div></div>
          <div className="grid grid-cols-2 gap-3">
            <label className="min-w-0"><span className="field-label">Pedidos</span><Select value={filters.orderState} onChange={e => setFilters({ orderState: e.target.value as typeof filters.orderState })} options={[{ value: 'todos', label: 'Todos' }, { value: 'con_pedido', label: 'Con pedido pendiente' }, { value: 'sin_pedido', label: 'Sin pedido' }]} className="sm:h-10" /></label>
            <label className="min-w-0"><span className="field-label">Visitas</span><Select value={filters.visitState} onChange={e => setFilters({ visitState: e.target.value as typeof filters.visitState })} options={[{ value: 'todos', label: 'Todas' }, { value: 'visitados_hoy', label: 'Visitados hoy' }, { value: 'no_visitados', label: 'Sin visita hoy' }]} className="sm:h-10" /></label>
          </div>
          <details className="rounded-xl border border-line bg-surface-800 p-3"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-xs font-medium text-ink">Antigüedad y actividad<ChevronDown className="h-4 w-4 text-ink-faint" /></summary>
            <div className="mt-3 space-y-3"><div className="grid grid-cols-2 gap-3">
              <NumberField label="Sin comprar: desde" suffix="días" min={0} value={filters.minDaysSincePurchase ?? ''} onChange={e => setFilters({ minDaysSincePurchase: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Sin límite" className="sm:h-10" />
              <NumberField label="Sin comprar: hasta" suffix="días" min={0} value={filters.maxDaysSincePurchase ?? ''} onChange={e => setFilters({ maxDaysSincePurchase: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Sin límite" className="sm:h-10" />
            </div><NumberField label="Sin visita: máximo" suffix="días" min={0} value={filters.maxDaysSinceVisit ?? ''} onChange={e => setFilters({ maxDaysSinceVisit: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Sin límite" className="sm:h-10" /></div>
          </details>
        </>}
      </section> : null}
      {tab === 'territory' ? <section aria-label="Filtros de territorio" className="space-y-3">
        <div><h3 className="text-[13px] font-semibold text-ink">Comunas y sectores</h3><p className="mt-0.5 text-2xs text-ink-muted">Selecciona las comunas de tus clientes.</p></div>
        {communes.length === 0 ? <FilterEmpty icon={MapPin} title="Sin comunas disponibles" description="Aquí aparecerán las comunas asociadas a tus clientes." /> : <>
          <SearchInput aria-label="Buscar comuna" value={communeSearch} onChange={e => setCommuneSearch(e.target.value)} onClear={() => setCommuneSearch('')} placeholder="Buscar una comuna" className="sm:h-10" />
          <div className="space-y-1">{shownCommunes.map(commune => <button key={commune.code} type="button" aria-pressed={filters.communeCodes.includes(commune.code)} onClick={() => toggleCommune(commune.code)} className={cn('flex min-h-11 w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs', filters.communeCodes.includes(commune.code) ? 'border-brand-500/40 bg-brand-500/10 text-brand-700' : 'border-line bg-surface-900 text-ink-muted')}>
            <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', filters.communeCodes.includes(commune.code) ? 'border-brand-500 bg-brand-600 text-white' : 'border-line-strong')}>{filters.communeCodes.includes(commune.code) ? <Check className="h-3 w-3" /> : null}</span><span className="min-w-0 flex-1 truncate">{commune.name}</span><span className="numeric text-2xs opacity-70">{commune.count}</span>
          </button>)}</div>
          {!shownCommunes.length ? <p className="py-4 text-center text-xs text-ink-muted">No hay comunas que coincidan.</p> : null}
        </>}
      </section> : null}
    </div>
  </div>;
}

function FilterEmpty({ icon: Icon, title, description }: { icon: typeof Truck; title: string; description: string }) {
  return <div className="rounded-xl border border-dashed border-line-strong bg-surface-800 px-5 py-7 text-center">
    <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-900 text-brand-700"><Icon className="h-5 w-5" /></span>
    <p className="text-xs font-medium text-ink">{title}</p><p className="mx-auto mt-1 max-w-[280px] text-2xs leading-relaxed text-ink-muted">{description}</p>
  </div>;
}

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
