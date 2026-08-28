'use client';

import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Route as RouteIcon,
  Truck,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { SeverityBadge, WorkOrderStatusBadge } from '@/components/common/status';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '@/lib/engines/vehicle-activity';
import { formatElapsed, formatRelative, formatSpeed, formatTime, normalizeSearch } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { Alert, Position, VehicleActivityStatus } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

/**
 * Panel operacional de la torre de control.
 *
 * Acompana al mapa con la lista de lo que esta ocurriendo. Pulsar cualquier
 * fila centra el mapa y abre su ficha: la idea es que el operador no tenga
 * que abandonar esta pantalla para entender la operacion.
 */

type PanelTab = 'vehiculos' | 'ordenes' | 'alertas' | 'rutas';

const TABS: { id: PanelTab; label: string; icon: typeof Truck }[] = [
  { id: 'vehiculos', label: 'Flota', icon: Truck },
  { id: 'ordenes', label: 'Despachos', icon: ClipboardList },
  { id: 'alertas', label: 'Alertas', icon: AlertTriangle },
  { id: 'rutas', label: 'Rutas', icon: RouteIcon },
];

export interface OperationsPanelProps {
  snapshot: MapSnapshot | null;
  alerts: Alert[];
  positions: Map<string, Position>;
  onSelectVehicle: (vehicleId: string) => void;
  onSelectWorkOrder: (workOrderId: string) => void;
}

export function OperationsPanel({
  snapshot,
  alerts,
  positions,
  onSelectVehicle,
  onSelectWorkOrder,
}: OperationsPanelProps) {
  const [tab, setTab] = useState<PanelTab>('vehiculos');
  const [search, setSearch] = useState('');

  const focusOn = useMapStore((s) => s.focusOn);
  const highlightRoute = useMapStore((s) => s.highlightRoute);
  const select = useMapStore((s) => s.select);

  const term = normalizeSearch(search);

  const vehicles = useMemo(() => {
    const list = snapshot?.vehicles ?? [];
    const filtered =
      term.length === 0
        ? list
        : list.filter((v) =>
            normalizeSearch(
              `${v.vehicle.plate} ${v.vehicle.fleetCode} ${v.driver?.fullName ?? ''}`,
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
  }, [snapshot, term]);

  const workOrders = useMemo(() => {
    const list = snapshot?.pendingWorkOrders ?? [];
    return term.length === 0
      ? list
      : list.filter((w) =>
          normalizeSearch(`${w.number} ${w.clientName} ${w.communeName}`).includes(term),
        );
  }, [snapshot, term]);

  const openAlerts = useMemo(() => {
    const list = alerts.filter((a) => a.state !== 'resuelta');
    return term.length === 0
      ? list
      : list.filter((a) =>
          normalizeSearch(`${a.title} ${a.description} ${a.vehiclePlate ?? ''}`).includes(term),
        );
  }, [alerts, term]);

  const routes = useMemo(() => {
    const list = snapshot?.routes ?? [];
    return term.length === 0
      ? list
      : list.filter((r) => normalizeSearch(`${r.code} ${r.name} ${r.vehiclePlate ?? ''}`).includes(term));
  }, [snapshot, term]);

  const counts: Record<PanelTab, number> = {
    vehiculos: vehicles.length,
    ordenes: workOrders.length,
    alertas: openAlerts.length,
    rutas: routes.length,
  };

  return (
    <div className="flex h-full flex-col bg-surface-900">
      {/* --- Pestanas --- */}
      <div className="flex border-b border-line">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          const active = tab === entry.id;

          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 border-b-2 px-2 py-2.5 transition-colors',
                active
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-ink-faint hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="text-2xs font-medium">{entry.label}</span>
              <span className="numeric text-2xs opacity-70">{counts[entry.id]}</span>
            </button>
          );
        })}
      </div>

      <div className="border-b border-line p-2.5">
        <SearchInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch('')}
          placeholder="Filtrar en el panel"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'vehiculos' ? (
          vehicles.length === 0 ? (
            <EmptyState
              compact
              icon={<Truck className="h-5 w-5" />}
              title="Sin vehiculos que coincidan"
              description="Ajusta el filtro para ver el resto de la flota."
            />
          ) : (
            <ul className="divide-y divide-line">
              {vehicles.map((snap) => {
                const live = positions.get(snap.vehicle.id) ?? snap.position;

                return (
                  <li key={snap.vehicle.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectVehicle(snap.vehicle.id);
                        if (live) focusOn({ lat: live.lat, lng: live.lng }, 14.5);
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

        {tab === 'ordenes' ? (
          workOrders.length === 0 ? (
            <EmptyState
              compact
              icon={<ClipboardList className="h-5 w-5" />}
              title="Sin despachos pendientes"
              description="Todas las ordenes del dia estan cerradas o filtradas."
            />
          ) : (
            <ul className="divide-y divide-line">
              {workOrders.map((workOrder) => (
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

        {tab === 'alertas' ? (
          openAlerts.length === 0 ? (
            <EmptyState
              compact
              icon={<AlertTriangle className="h-5 w-5" />}
              title="Sin alertas abiertas"
              description="La operacion esta dentro de los parametros configurados."
            />
          ) : (
            <ul className="divide-y divide-line">
              {openAlerts.slice(0, 60).map((alert) => (
                <li key={alert.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (alert.vehicleId) {
                        select({ type: 'vehicle', id: alert.vehicleId });
                        onSelectVehicle(alert.vehicleId);
                      }
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
                    <p className="mt-0.5 text-2xs text-ink-faint">{formatRelative(alert.timestamp)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === 'rutas' ? (
          routes.length === 0 ? (
            <EmptyState
              compact
              icon={<RouteIcon className="h-5 w-5" />}
              title="Sin rutas activas"
              description="No hay rutas planificadas que coincidan con el filtro."
            />
          ) : (
            <ul className="divide-y divide-line">
              {routes.map((route) => {
                const done = route.stops.filter((s) =>
                  ['visita_detectada', 'completada'].includes(s.status),
                ).length;
                const next = route.stops.find((s) => s.status === 'proxima' || s.status === 'en_cliente');

                return (
                  <li key={route.routeId}>
                    <button
                      type="button"
                      onClick={() => {
                        highlightRoute(route.routeId);
                        const first = route.plannedPath[0];
                        if (first) focusOn(first, 12);
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
                      <p className="mt-0.5 truncate text-2xs text-ink">{route.name}</p>
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
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-2xs text-ink-faint">
        <Building2 className="h-3 w-3" />
        <span>{snapshot?.clients.length ?? 0} clientes en el area de operacion</span>
      </div>
    </div>
  );
}
