'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SeverityBadge, WorkOrderStatusBadge } from '@/components/common/status';
import { alertsQuery } from '@/hooks/use-control-data';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { containsPoint } from '@/lib/engines/geofence-engine';
import { isUsableCoordinate } from '@/lib/geo';
import { formatSmartDateTime } from '@/lib/format';
import { geofencePoints } from '@/lib/map-navigation';
import { GEOFENCE_KIND_LABEL } from '@/features/base/geofence-editor/geofence-form';
import { useMapStore, type MapSelection } from '@/stores/map-store';
import type { Alert, AlertState } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

const linkClass = 'flex min-h-11 items-center justify-center rounded-md border border-line-strong px-3 text-xs font-medium text-brand-700 hover:bg-surface-800';

export function MapEntityPanel({ selection, snapshot }: { selection: NonNullable<MapSelection>; snapshot: MapSnapshot | null }) {
  if (selection.type === 'alert') return <AlertDetail key={selection.id} id={selection.id} />;
  if (selection.type === 'geofence') return <GeofenceDetail id={selection.id} snapshot={snapshot} />;
  if (selection.type === 'route') return <RouteDetail id={selection.id} snapshot={snapshot} />;
  return null;
}

function GeofenceDetail({ id, snapshot }: { id: string; snapshot: MapSnapshot | null }) {
  const geofence = snapshot?.geofences.find((g) => g.id === id);
  const { positions } = useLiveFleet();
  const fitPoints = useMapStore((s) => s.fitPoints);
  const select = useMapStore((s) => s.select);
  if (!geofence) return <p className="p-4 text-xs text-ink-faint">La geocerca ya no está disponible. Actualiza la operación.</p>;
  const inside = (snapshot?.vehicles ?? []).filter((v) => {
    const point = positions.get(v.vehicle.id) ?? v.position;
    return point && isUsableCoordinate(point) && containsPoint(geofence, point);
  });
  return <div className="space-y-4 p-4">
    <div><div className="mb-2 flex items-center gap-2"><Badge tone={geofence.active ? 'active' : 'neutral'}>{geofence.active ? 'Activa' : 'Inactiva'}</Badge><span className="text-xs text-ink-faint">{GEOFENCE_KIND_LABEL[geofence.kind]}</span></div><h3 className="text-base font-semibold text-ink">{geofence.name}</h3><p className="mt-1 text-xs text-ink-muted">{geofence.description ?? 'Sin descripción'}</p></div>
    {!geofence.active ? <p className="rounded-md bg-surface-800 p-3 text-xs text-ink-muted">Esta geocerca está inactiva: no genera detecciones ni aparece en la capa de perímetros activos.</p> : null}
    <dl className="grid grid-cols-2 gap-3 rounded-md border border-line p-3 text-xs">
      <div><dt className="text-ink-faint">Geometría</dt><dd className="mt-1 text-ink">{geofence.geometry.shape === 'circle' ? `Radio de ${geofence.geometry.radiusMeters} m` : `Polígono · ${geofence.geometry.vertices.length} vértices`}</dd></div>
      <div><dt className="text-ink-faint">Permanencia mínima</dt><dd className="mt-1 text-ink">{geofence.rules.minDwellSeconds ?? geofence.minDwellSeconds ?? 'Sin configurar'}{(geofence.rules.minDwellSeconds ?? geofence.minDwellSeconds) !== null ? ' s' : ''}</dd></div>
      <div><dt className="text-ink-faint">Permanencia máxima</dt><dd className="mt-1 text-ink">{geofence.rules.maxDwellSeconds === null ? 'Sin límite' : `${geofence.rules.maxDwellSeconds} s`}</dd></div>
      <div><dt className="text-ink-faint">Horario autorizado</dt><dd className="mt-1 text-ink">{geofence.rules.allowedFrom && geofence.rules.allowedTo ? `${geofence.rules.allowedFrom} – ${geofence.rules.allowedTo}` : 'Sin restricción horaria'}</dd></div>
      <div><dt className="text-ink-faint">Severidad</dt><dd className="mt-1"><SeverityBadge severity={geofence.rules.severity} /></dd></div>
      <div><dt className="text-ink-faint">Vehículos autorizados</dt><dd className="mt-1 text-ink">{geofence.rules.allowedVehicleIds.length ? geofence.rules.allowedVehicleIds.map((vehicleId) => snapshot?.vehicles.find((v) => v.vehicle.id === vehicleId)?.vehicle.plate ?? vehicleId).join(', ') : 'Toda la flota'}</dd></div>
    </dl>
    <div><h4 className="text-xs font-semibold text-ink">Eventos configurados</h4><div className="mt-2 flex flex-wrap gap-2">{geofence.rules.triggers.length ? geofence.rules.triggers.map((trigger) => <Badge key={trigger}>{trigger.replaceAll('_', ' ')}</Badge>) : <p className="text-xs text-ink-faint">Sin eventos configurados</p>}</div></div>
    <div><h4 className="text-xs font-semibold text-ink">Vehículos dentro del perímetro · {inside.length}</h4><p className="mt-1 text-2xs text-ink-faint">Según la última posición disponible; consulta la ficha para verificar su antigüedad.</p><ul className="mt-2 divide-y divide-line">{inside.map((v) => <li key={v.vehicle.id}><button className="min-h-11 w-full text-left text-xs text-brand-700" onClick={() => select({ type: 'vehicle', id: v.vehicle.id })}>{v.vehicle.plate} · {v.driver?.fullName ?? 'Sin conductor'}</button></li>)}</ul></div>
    <Button block variant="secondary" onClick={() => fitPoints(geofencePoints(geofence))}>Encuadrar perímetro</Button>
    {geofence.clientId ? <Button block variant="secondary" onClick={() => select({ type: 'client', id: geofence.clientId! })}>Abrir cliente asociado</Button> : null}
    <Link className={linkClass} href={`/configuracion/geocercas?geocerca=${encodeURIComponent(id)}`}>Editar geocerca y reglas</Link>
  </div>;
}

function RouteDetail({ id, snapshot }: { id: string; snapshot: MapSnapshot | null }) {
  const route = snapshot?.routes.find((r) => r.routeId === id);
  const fitPoints = useMapStore((s) => s.fitPoints);
  const select = useMapStore((s) => s.select);
  const focusOn = useMapStore((s) => s.focusOn);
  if (!route) return <p className="p-4 text-xs text-ink-faint">La ruta ya no está disponible.</p>;
  const done = route.stops.filter((s) => s.status === 'completada' || s.status === 'visita_detectada').length;
  return <div className="space-y-4 p-4">
    <div><p className="text-xs font-semibold text-brand-700">{route.code}</p><h3 className="mt-1 text-base font-semibold text-ink">{route.name}</h3><p className="mt-1 text-xs text-ink-muted">{route.vehiclePlate ?? 'Sin vehículo asignado'} · {done}/{route.stops.length} paradas completadas o con visita detectada</p></div>
    <progress aria-label="Avance de paradas" className="h-2 w-full accent-brand-600" value={done} max={Math.max(1, route.stops.length)} />
    <Button block variant="secondary" onClick={() => fitPoints([...route.plannedPath, ...route.executedPath, ...route.stops])}>Ver recorrido completo</Button>
    {route.vehicleId ? <Button block variant="secondary" onClick={() => select({ type: 'vehicle', id: route.vehicleId! })}>Abrir vehículo asignado</Button> : null}
    <ol className="divide-y divide-line">{route.stops.map((stop) => <li key={`${stop.sequence}-${stop.workOrderId}`}><button type="button" className="w-full py-3 text-left" onClick={() => { select({ type: 'workOrder', id: stop.workOrderId }); focusOn(stop, 16); }}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-ink">{stop.sequence}. {stop.clientName}</span><WorkOrderStatusBadge status={stop.status} /></div><p className="mt-1 text-2xs text-ink-faint">{stop.addressLine}</p>{stop.plannedArrivalAt ? <p className="mt-1 text-2xs text-ink-faint">Planificada: {formatSmartDateTime(stop.plannedArrivalAt)}</p> : null}{stop.actualArrivalAt ? <p className="text-2xs text-brand-700">Llegada: {formatSmartDateTime(stop.actualArrivalAt)}</p> : null}
    </button></li>)}</ol>
    <Link className={linkClass} href={`/rutas/${encodeURIComponent(id)}`}>Abrir planificación de ruta</Link>
  </div>;
}

function AlertDetail({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(alertsQuery);
  const select = useMapStore((s) => s.select);
  const focusOn = useMapStore((s) => s.focusOn);
  const mutation = useMutation({
    mutationFn: async (state: AlertState): Promise<Alert> => {
      const response = await fetch(`/api/alertas/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state }) });
      if (!response.ok) throw new Error(response.status === 403 ? 'Tu usuario no tiene permiso para gestionar alertas.' : 'No fue posible actualizar la alerta. Intenta nuevamente.');
      return response.json() as Promise<Alert>;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(alertsQuery.queryKey, (previous) => previous ? { ...previous, alerts: previous.alerts.map((a) => a.id === id ? updated : a) } : { alerts: [updated] });
      for (const queryKey of [['alerts'], ['map', 'snapshot'], ['dashboard'], ['communes'], ['vehicle']]) void queryClient.invalidateQueries({ queryKey });
    },
  });
  const alert = query.data?.alerts.find((a) => a.id === id) ?? mutation.data;
  if (!alert) return <div className="space-y-3 p-4"><p className="text-xs text-ink-faint">{query.isLoading ? 'Cargando alerta…' : query.isError ? 'No fue posible cargar la alerta.' : 'La alerta ya no está disponible.'}</p><Button variant="secondary" onClick={() => void query.refetch()}>Reintentar</Button></div>;
  return <div className="space-y-4 p-4">
    <div className="flex gap-2"><SeverityBadge severity={alert.severity} /><Badge>{alert.state}</Badge></div><h3 className="text-base font-semibold text-ink">{alert.title}</h3><p className="text-sm text-ink-muted">{alert.description}</p><p className="text-xs text-ink-faint">{formatSmartDateTime(alert.timestamp)}</p>
    {alert.position && isUsableCoordinate(alert.position) ? <Button block variant="secondary" onClick={() => focusOn(alert.position!, 15)}>Centrar ubicación de la alerta</Button> : <p className="text-xs text-ink-faint">Sin ubicación GPS asociada.</p>}
    {alert.vehicleId ? <Button block variant="secondary" onClick={() => select({ type: 'vehicle', id: alert.vehicleId! })}>Vehículo · {alert.vehiclePlate ?? 'Abrir ficha'}</Button> : null}
    {alert.clientId ? <Button block variant="secondary" onClick={() => select({ type: 'client', id: alert.clientId! })}>Cliente · {alert.clientName ?? 'Abrir ficha'}</Button> : null}
    {alert.workOrderId ? <Button block variant="secondary" onClick={() => select({ type: 'workOrder', id: alert.workOrderId! })}>Despacho · {alert.workOrderNumber ?? 'Abrir orden'}</Button> : null}
    {mutation.error ? <p role="alert" className="text-xs text-status-dormant">{mutation.error.message}</p> : null}
    {mutation.isSuccess ? <p role="status" className="text-xs text-status-active">Estado actualizado correctamente.</p> : null}
    <div className="flex flex-wrap gap-2">{alert.state === 'nueva' ? <Button variant="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate('revisada')}>Marcar revisada</Button> : null}{alert.state !== 'resuelta' ? <Button disabled={mutation.isPending} onClick={() => mutation.mutate('resuelta')}>Resolver alerta</Button> : <Button variant="secondary" disabled={mutation.isPending} onClick={() => mutation.mutate('nueva')}>Reabrir alerta</Button>}</div>
    <Link className={linkClass} href={`/alertas?alerta=${encodeURIComponent(id)}`}>Abrir centro de alertas</Link>
  </div>;
}
