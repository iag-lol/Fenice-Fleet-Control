'use client';

import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Route as RouteIcon,
  Truck,
  Shield,
  Landmark,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ClientStatusBadge,
  SeverityBadge,
  WORK_ORDER_STATUS_LABEL,
  WorkOrderStatusBadge,
} from '@/components/common/status';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput, Select } from '@/components/ui/input';
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '@/lib/engines/vehicle-activity';
import {
  formatElapsed,
  formatRelative,
  formatSpeed,
  formatTime,
  normalizeSearch,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type {
  Alert,
  Position,
  RouteStatus,
  VehicleActivityStatus,
  WorkOrderStatus,
} from '@/types/core';
import type { CommuneWithSummary } from '@/components/map/commune-panel';
import { geofencePoints } from '@/lib/map-navigation';
import { isUsableCoordinate } from '@/lib/geo';
import { GEOFENCE_KIND_LABEL } from '@/config/geofence-labels';
import type { MapSnapshot } from '@/types/views';

/**
 * Panel operacional de la torre de control.
 *
 * Acompana al mapa con la lista de lo que esta ocurriendo. Pulsar cualquier
 * fila centra el mapa y abre su ficha: la idea es que el operador no tenga
 * que abandonar esta pantalla para entender la operacion.
 */

type PanelTab =
  | 'vehiculos'
  | 'clientes'
  | 'geocercas'
  | 'comunas'
  | 'ordenes'
  | 'alertas'
  | 'rutas';
const PAGE_SIZE = 50;

const ROUTE_STATUS_LABEL: Record<RouteStatus, string> = {
  planificada: 'Planificada',
  en_curso: 'En curso',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

const SEARCH_PLACEHOLDER: Record<PanelTab, string> = {
  vehiculos: 'Patente, código, conductor, geocerca…',
  clientes: 'Cliente, código, dirección, comuna…',
  geocercas: 'Geocerca, tipo, comuna…',
  comunas: 'Comuna, código, región…',
  ordenes: 'Despacho, cliente, dirección, comuna…',
  alertas: 'Alerta, patente, cliente, despacho…',
  rutas: 'Ruta, patente, parada, dirección…',
};

const TABS: { id: PanelTab; label: string; icon: typeof Truck }[] = [
  { id: 'vehiculos', label: 'Flota', icon: Truck },
  { id: 'clientes', label: 'Clientes', icon: Building2 },
  { id: 'geocercas', label: 'Geocercas', icon: Shield },
  { id: 'comunas', label: 'Comunas', icon: Landmark },
  { id: 'ordenes', label: 'Despachos', icon: ClipboardList },
  { id: 'alertas', label: 'Alertas', icon: AlertTriangle },
  { id: 'rutas', label: 'Rutas', icon: RouteIcon },
];

export interface OperationsPanelProps {
  snapshot: MapSnapshot | null;
  communes: CommuneWithSummary[];
  loading: boolean;
  error: string;
  refreshing: boolean;
  onRefresh: () => void;
  sourceStatus?: string;
  alerts: Alert[];
  positions: Map<string, Position>;
  onSelectVehicle: (vehicleId: string) => void;
  onSelectWorkOrder: (workOrderId: string) => void;
}

export function OperationsPanel({
  snapshot,
  communes,
  loading,
  error,
  refreshing,
  onRefresh,
  sourceStatus,
  alerts,
  positions,
  onSelectVehicle,
  onSelectWorkOrder,
}: OperationsPanelProps) {
  const [tab, setTab] = useState<PanelTab>('vehiculos');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [status, setStatus] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // El contenedor es compartido: al cambiar de sección o filtro, la lista
    // nueva debe empezar en su primer registro y no conservar el scroll viejo.
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [tab, search, status]);

  const focusOn = useMapStore((s) => s.focusOn);
  const fitPoints = useMapStore((s) => s.fitPoints);
  const inspectCommune = useMapStore((s) => s.inspectCommune);
  const select = useMapStore((s) => s.select);

  const term = normalizeSearch(search);

  const openAlertInventory = useMemo(
    () => alerts.filter((alert) => alert.state !== 'resuelta'),
    [alerts],
  );
  const sourceEmpty =
    Boolean(sourceStatus) &&
    !loading &&
    (!snapshot ||
      (snapshot.vehicles.length === 0 &&
        snapshot.clients.length === 0 &&
        snapshot.routes.length === 0 &&
        snapshot.geofences.length === 0 &&
        snapshot.pendingWorkOrders.length === 0 &&
        snapshot.alerts.length === 0)) &&
    openAlertInventory.length === 0;

  const vehicles = useMemo(() => {
    const list = (snapshot?.vehicles ?? []).filter(
      (v) => tab !== 'vehiculos' || !status || v.activityStatus === status,
    );
    const filtered =
      term.length === 0
        ? list
        : list.filter((v) =>
            normalizeSearch(
              `${v.vehicle.plate} ${v.vehicle.fleetCode} ${v.driver?.fullName ?? ''} ${v.insideGeofenceName ?? ''} ${ACTIVITY_LABEL[v.activityStatus]}`,
            ).includes(term),
          );

    // Lo que requiere atencion primero: alerta, desvio, detenido, y al final
    // lo que va bien. El operador no deberia tener que buscar el problema.
    const priority: Record<VehicleActivityStatus, number> = {
      warning: 0,
      deviated: 1,
      offline: 2,
      stopped: 3,
      delivering: 4,
      moving: 5,
    };
    return [...filtered].sort((a, b) => priority[a.activityStatus] - priority[b.activityStatus]);
  }, [snapshot, term, status, tab]);

  const workOrders = useMemo(() => {
    const list = (snapshot?.pendingWorkOrders ?? []).filter(
      (w) => tab !== 'ordenes' || !status || w.status === status,
    );
    return term.length === 0
      ? list
      : list.filter((w) =>
          normalizeSearch(
            `${w.number} ${w.clientName} ${w.addressLine} ${w.communeName} ${WORK_ORDER_STATUS_LABEL[w.status]}`,
          ).includes(term),
        );
  }, [snapshot, term, status, tab]);

  const openAlerts = useMemo(() => {
    const list = openAlertInventory
      .filter((a) => tab !== 'alertas' || !status || a.severity === status)
      .sort(
        (a, b) =>
          ({ critical: 0, warning: 1, info: 2 })[a.severity] -
            { critical: 0, warning: 1, info: 2 }[b.severity] ||
          b.timestamp.localeCompare(a.timestamp),
      );
    return term.length === 0
      ? list
      : list.filter((a) =>
          normalizeSearch(
            `${a.title} ${a.description} ${a.vehiclePlate ?? ''} ${a.clientName ?? ''} ${a.workOrderNumber ?? ''}`,
          ).includes(term),
        );
  }, [openAlertInventory, term, status, tab]);

  const routes = useMemo(() => {
    const list = (snapshot?.routes ?? []).filter(
      (route) => tab !== 'rutas' || !status || route.status === status,
    );
    return term.length === 0
      ? list
      : list.filter((r) =>
          normalizeSearch(
            `${r.code} ${r.name} ${r.vehiclePlate ?? ''} ${ROUTE_STATUS_LABEL[r.status]} ${r.stops.map((stop) => `${stop.clientName} ${stop.addressLine}`).join(' ')}`,
          ).includes(term),
        );
  }, [snapshot, term, status, tab]);

  const clients = (snapshot?.clients ?? []).filter(
    (c) =>
      (tab !== 'clientes' || !status || c.status === status) &&
      normalizeSearch(
        `${c.name} ${c.code} ${c.addressLine} ${c.communeName} ${c.salesRep ?? ''}`,
      ).includes(term),
  );
  const geofences = (snapshot?.geofences ?? []).filter(
    (g) =>
      (tab !== 'geocercas' || !status || String(g.active) === status) &&
      normalizeSearch(
        `${g.name} ${g.description ?? ''} ${GEOFENCE_KIND_LABEL[g.kind]} ${g.communeCode ?? ''}`,
      ).includes(term),
  );
  const territories = communes.filter((c) =>
    normalizeSearch(`${c.name} ${c.code} ${c.region}`).includes(term),
  );
  const statusOptions =
    tab === 'vehiculos'
      ? Object.entries(ACTIVITY_LABEL).map(([value, label]) => ({ value, label }))
      : tab === 'clientes'
        ? [
            { value: 'active', label: 'Activos' },
            { value: 'warning', label: 'En observación' },
            { value: 'dormant', label: 'Dormidos' },
          ]
        : tab === 'geocercas'
          ? [
              { value: 'true', label: 'Activas' },
              { value: 'false', label: 'Inactivas' },
            ]
          : tab === 'ordenes'
            ? (Object.entries(WORK_ORDER_STATUS_LABEL) as [WorkOrderStatus, string][]).map(
                ([value, label]) => ({ value, label }),
              )
            : tab === 'rutas'
              ? (Object.entries(ROUTE_STATUS_LABEL) as [RouteStatus, string][]).map(
                  ([value, label]) => ({ value, label }),
                )
              : tab === 'alertas'
                ? [
                    { value: 'critical', label: 'Críticas' },
                    { value: 'warning', label: 'Advertencias' },
                    { value: 'info', label: 'Informativas' },
                  ]
                : [];

  const counts: Record<PanelTab, number> = {
    clientes: clients.length,
    geocercas: geofences.length,
    comunas: territories.length,
    vehiculos: vehicles.length,
    ordenes: workOrders.length,
    alertas: openAlerts.length,
    rutas: routes.length,
  };
  const totals: Record<PanelTab, number> = {
    clientes: snapshot?.clients.length ?? 0,
    geocercas: snapshot?.geofences.length ?? 0,
    comunas: communes.length,
    vehiculos: snapshot?.vehicles.length ?? 0,
    ordenes: snapshot?.pendingWorkOrders.length ?? 0,
    alertas: openAlertInventory.length,
    rutas: snapshot?.routes.length ?? 0,
  };
  const filtered = Boolean(term || status);

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-900">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Operación y territorio</h2>
          <p className="hidden truncate text-2xs text-ink-faint md:block">
            {snapshot
              ? `Actualizado ${formatTime(snapshot.generatedAt)}`
              : 'Conectando con la operación…'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Actualizar torre de control"
          title="Actualizar datos"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-brand-700 disabled:opacity-50"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </button>
      </div>
      {error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-status-warning/30 bg-status-warning/10 p-2 text-xs text-status-warning"
        >
          {error} {snapshot ? 'Se conservan los últimos datos disponibles.' : ''}
          <button type="button" className="ml-1 underline" onClick={onRefresh}>
            Reintentar
          </button>
        </div>
      ) : null}
      <div
        className="flex shrink-0 snap-x snap-mandatory overflow-x-auto border-b border-line md:grid md:grid-cols-4"
        aria-label="Secciones de la operación"
      >
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.id;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => {
                setTab(entry.id);
                setStatus('');
                setLimit(PAGE_SIZE);
              }}
              aria-pressed={active}
              className={cn(
                'flex min-h-11 min-w-0 shrink-0 snap-start items-center justify-center gap-1 border-b-2 px-2 transition-colors md:px-1',
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-faint hover:text-ink',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 md:hidden" />
              <span className="text-2xs font-medium">{entry.label}</span>
              <span
                className={cn(
                  'numeric shrink-0 rounded px-1 text-[10px] font-semibold',
                  active ? 'bg-brand-500/15 text-brand-700' : 'bg-surface-750 text-ink-faint',
                )}
              >
                {sourceEmpty && entry.id !== 'comunas' ? '—' : totals[entry.id]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line p-2">
        <div className="min-w-0 flex-[1_1_160px]">
          <SearchInput
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            onClear={() => {
              setSearch('');
              setLimit(PAGE_SIZE);
            }}
            aria-label={`Buscar en ${TABS.find((entry) => entry.id === tab)?.label ?? 'la torre de control'}`}
            placeholder={SEARCH_PLACEHOLDER[tab]}
          />
        </div>
        {statusOptions.length ? (
          <Select
            className="min-w-0 flex-[0_1_140px] md:flex-[1_1_100%]"
            aria-label="Filtrar por estado"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            options={[{ value: '', label: 'Todos los estados' }, ...statusOptions]}
          />
        ) : null}
        {filtered ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setStatus('');
              setLimit(PAGE_SIZE);
            }}
            className="min-h-9 shrink-0 rounded px-2 text-2xs font-medium text-brand-700 hover:bg-surface-800"
          >
            Limpiar filtros
          </button>
        ) : null}
      </div>

      {loading ? (
        <p role="status" className="p-4 text-xs text-ink-faint">
          Cargando la operación…
        </p>
      ) : null}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {sourceEmpty ? (
          <div
            role="status"
            className="border-b border-status-warning/30 bg-status-warning/10 px-3 py-4 text-xs leading-relaxed text-ink"
          >
            <p className="font-semibold text-status-warning">
              Fuente operativa pendiente de conexión
            </p>
            <p className="mt-1">
              Aún no hay registros para verificar la actividad de la flota, clientes, geocercas ni
              despachos. Los contadores operativos se mostrarán cuando lleguen datos. Las comunas
              disponibles son cartografía territorial.
            </p>
            <p className="mt-1 text-ink-muted">{sourceStatus}</p>
          </div>
        ) : null}
        {!loading && !sourceEmpty && tab === 'clientes' ? (
          <ul className="divide-y divide-line">
            {clients.slice(0, limit).map((client) => (
              <li key={client.clientId}>
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left hover:bg-surface-800"
                  onClick={() => {
                    select({ type: 'client', id: client.clientId });
                    focusOn(client, 16);
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">{client.name}</span>
                    <ClientStatusBadge status={client.status} size="sm" />
                  </div>
                  <p className="mt-1 truncate text-2xs text-ink-faint">
                    {client.code} · {client.communeName}
                  </p>
                  <p className="truncate text-2xs text-ink-faint">{client.addressLine}</p>
                  <p className="mt-1 text-2xs text-brand-700">
                    {client.hasPendingOrder ? 'Pedido pendiente' : 'Sin pedido pendiente'}
                    {client.visitedToday ? ' · Visitado hoy' : ''}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!loading && !sourceEmpty && tab === 'geocercas' ? (
          <ul className="divide-y divide-line">
            {geofences.slice(0, limit).map((geofence) => (
              <li key={geofence.id}>
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left hover:bg-surface-800"
                  onClick={() => {
                    select({ type: 'geofence', id: geofence.id });
                    fitPoints(geofencePoints(geofence));
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: geofence.color }}
                    />
                    <span className="flex-1 truncate text-[13px] font-medium text-ink">
                      {geofence.name}
                    </span>
                    <Badge tone={geofence.active ? 'active' : 'neutral'}>
                      {geofence.active ? 'Activa' : 'Inactiva'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-2xs text-ink-faint">
                    {GEOFENCE_KIND_LABEL[geofence.kind]} ·{' '}
                    {geofence.geometry.shape === 'circle'
                      ? `${geofence.geometry.radiusMeters} m de radio`
                      : `${geofence.geometry.vertices.length} vértices`}
                  </p>
                  <p className="truncate text-2xs text-ink-faint">
                    {geofence.rules.triggers.length} reglas ·{' '}
                    {geofence.description ?? 'Sin descripción'}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!loading && tab === 'comunas' ? (
          <ul className="divide-y divide-line">
            {territories.slice(0, limit).map((commune) => (
              <li key={commune.code}>
                <button
                  type="button"
                  className="w-full px-3 py-3 text-left hover:bg-surface-800"
                  onClick={() => {
                    inspectCommune(commune.code);
                    fitPoints(commune.boundary.length ? commune.boundary : [commune.center]);
                  }}
                >
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-ink">
                      {commune.name}
                    </span>
                    <span className="numeric text-2xs text-ink-faint">{commune.code}</span>
                  </div>
                  {commune.summary ? (
                    <>
                      <p className="mt-1 text-2xs text-ink-faint">
                        {commune.summary.clients} clientes · {commune.summary.vehiclesInside}{' '}
                        vehículos
                      </p>
                      <p className="text-2xs text-brand-700">
                        {commune.summary.pendingToday} despachos pendientes ·{' '}
                        {commune.summary.openAlerts} alertas
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-2xs text-ink-faint">
                      Sin datos operativos para esta comuna
                    </p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {!loading &&
        (!sourceEmpty || tab === 'comunas') &&
        ['clientes', 'geocercas', 'comunas'].includes(tab) &&
        counts[tab] === 0 ? (
          <EmptyState
            compact
            title={filtered ? 'Sin coincidencias' : `Sin ${tab} registrados`}
            description={
              filtered
                ? 'Ajusta la búsqueda o el estado para ver los demás registros.'
                : 'Esta sección no tiene registros en los datos disponibles.'
            }
          />
        ) : null}
        {!loading && !sourceEmpty && tab === 'vehiculos' ? (
          vehicles.length === 0 ? (
            <EmptyState
              compact
              icon={<Truck className="h-5 w-5" />}
              title={filtered ? 'Sin vehículos que coincidan' : 'Sin vehículos registrados'}
              description={
                filtered
                  ? 'Ajusta la búsqueda o el estado para ver el resto de la flota.'
                  : 'La fuente disponible no contiene vehículos.'
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {vehicles.slice(0, limit).map((snap) => {
                const live = positions.get(snap.vehicle.id) ?? snap.position;

                return (
                  <li key={snap.vehicle.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectVehicle(snap.vehicle.id);
                        if (live && isUsableCoordinate(live))
                          focusOn({ lat: live.lat, lng: live.lng }, 14.5);
                      }}
                      className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-800"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: ACTIVITY_COLOR[snap.activityStatus] }}
                        />
                        <span className="truncate text-[13px] font-medium text-ink">
                          {snap.vehicle.plate}
                        </span>
                        <span className="numeric shrink-0 text-2xs text-ink-faint">
                          {snap.vehicle.fleetCode}
                        </span>
                        <span className="numeric ml-auto shrink-0 text-2xs text-ink-muted">
                          {formatSpeed(live?.speed ?? null)}
                        </span>
                      </div>

                      <p className="mt-0.5 truncate text-2xs text-ink-faint">
                        {ACTIVITY_LABEL[snap.activityStatus]}
                        {snap.insideGeofenceName ? ` · ${snap.insideGeofenceName}` : ''}
                      </p>

                      <p className="truncate text-2xs text-ink-faint">
                        {!live || !isUsableCoordinate(live) ? 'Sin posición GPS válida · ' : ''}
                        {snap.driver?.fullName ?? 'Sin conductor'} ·{' '}
                        {formatElapsed(snap.device?.secondsSinceLastPosition ?? null)}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {!loading && !sourceEmpty && tab === 'ordenes' ? (
          workOrders.length === 0 ? (
            <EmptyState
              compact
              icon={<ClipboardList className="h-5 w-5" />}
              title={filtered ? 'Sin despachos que coincidan' : 'Sin despachos pendientes'}
              description={
                filtered
                  ? 'Ajusta la búsqueda o el estado para ver los demás despachos.'
                  : 'No hay despachos pendientes en los datos disponibles.'
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {workOrders.slice(0, limit).map((workOrder) => (
                <li key={workOrder.workOrderId}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelectWorkOrder(workOrder.workOrderId);
                      focusOn({ lat: workOrder.lat, lng: workOrder.lng }, 15);
                    }}
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-800"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="numeric truncate text-[13px] font-medium text-brand-700">
                        {workOrder.number}
                      </span>
                      <WorkOrderStatusBadge status={workOrder.status} />
                    </div>
                    <p className="mt-0.5 truncate text-2xs text-ink">{workOrder.clientName}</p>
                    <p className="truncate text-2xs text-ink-faint">
                      {workOrder.addressLine}, {workOrder.communeName}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {!loading && !sourceEmpty && tab === 'alertas' ? (
          openAlerts.length === 0 ? (
            <EmptyState
              compact
              icon={<AlertTriangle className="h-5 w-5" />}
              title={filtered ? 'Sin alertas que coincidan' : 'Sin alertas abiertas'}
              description={
                filtered
                  ? 'Ajusta la búsqueda o el estado para ver las demás alertas.'
                  : 'No hay alertas abiertas en los datos disponibles.'
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {openAlerts.slice(0, limit).map((alert) => (
                <li key={alert.id}>
                  <button
                    type="button"
                    onClick={() => {
                      select({ type: 'alert', id: alert.id });
                      if (alert.position) focusOn(alert.position, 15);
                    }}
                    className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-800"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                        {alert.title}
                      </span>
                      <SeverityBadge severity={alert.severity} />
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-ink-faint">
                      {alert.description}
                    </p>
                    <p className="mt-0.5 text-2xs text-ink-faint">
                      {formatRelative(alert.timestamp)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {!loading && !sourceEmpty && tab === 'rutas' ? (
          routes.length === 0 ? (
            <EmptyState
              compact
              icon={<RouteIcon className="h-5 w-5" />}
              title={filtered ? 'Sin rutas que coincidan' : 'Sin rutas registradas'}
              description={
                filtered
                  ? 'Ajusta la búsqueda o el estado para ver las demás rutas.'
                  : 'No hay rutas en los datos disponibles.'
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {routes.slice(0, limit).map((route) => {
                const done = route.stops.filter((s) =>
                  ['visita_detectada', 'completada'].includes(s.status),
                ).length;
                const next = route.stops.find(
                  (s) => s.status === 'proxima' || s.status === 'en_cliente',
                );

                return (
                  <li key={route.routeId}>
                    <button
                      type="button"
                      onClick={() => {
                        select({ type: 'route', id: route.routeId });
                        fitPoints([...route.plannedPath, ...route.stops]);
                      }}
                      className="w-full px-3 py-2.5 text-left transition-colors hover:bg-surface-800"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="numeric truncate text-[13px] font-medium text-brand-700">
                          {route.code}
                        </span>
                        <Badge tone={done === route.stops.length ? 'active' : 'neutral'}>
                          {done}/{route.stops.length}
                        </Badge>
                      </div>
                      <p className="mt-0.5 truncate text-2xs text-ink">
                        {route.name} · {ROUTE_STATUS_LABEL[route.status]}
                      </p>
                      <p className="truncate text-2xs text-ink-faint">
                        {route.vehiclePlate ?? 'Sin camion'}
                        {next ? ` · proxima: ${next.clientName}` : ''}
                        {next?.plannedArrivalAt ? ` (${formatTime(next.plannedArrivalAt)})` : ''}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
        {!loading && (!sourceEmpty || tab === 'comunas') && counts[tab] > limit ? (
          <button
            type="button"
            className="min-h-11 w-full border-t border-line text-xs font-medium text-brand-700"
            onClick={() => setLimit((value) => value + PAGE_SIZE)}
          >
            Mostrar más ({counts[tab] - limit} restantes)
          </button>
        ) : null}
      </div>

      <div
        aria-live="polite"
        className="flex items-center gap-2 border-t border-line px-3 py-2 text-2xs text-ink-faint"
      >
        <Building2 className="h-3 w-3" />
        <span>
          {sourceEmpty && tab !== 'comunas'
            ? 'Esperando datos operativos'
            : loading
              ? 'Cargando resultados…'
              : `${Math.min(limit, counts[tab])} de ${counts[tab]} resultados${filtered ? ` · ${totals[tab]} en total` : ''}`}
        </span>
      </div>
    </div>
  );
}
