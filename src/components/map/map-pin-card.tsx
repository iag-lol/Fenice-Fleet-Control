'use client';

import type { Map as MapLibreMap } from 'maplibre-gl';
import { MapAnchoredCard } from './map-anchored-card';
import { Clock3, MapPin, Navigation, Pause, Radio, Zap } from 'lucide-react';
import type { ClientMapPoint, RouteGeometry } from '@/types/views';
import type { TrajectoryEventInput } from './map-layers';

export type MapPin =
  | { kind: 'client'; data: ClientMapPoint }
  | { kind: 'event'; data: TrajectoryEventInput }
  | { kind: 'delivery'; data: RouteGeometry['stops'][number]; routeCode: string };

const dateTime = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Santiago' }).format(new Date(value))
  : 'Sin registro';
const elapsed = (days: number | null) => days === null ? 'Sin registro' : days === 0 ? 'Hoy' : `Hace ${days} días`;
const eventNames = { stop: 'Detención', speeding: 'Velocidad sobre umbral', ignition_on: 'Contacto activado', ignition_off: 'Contacto desactivado', signal_gap: 'Sin continuidad GPS' };

export function PinCardContent({ pin, compact = false }: { pin: MapPin; compact?: boolean }) {
  const client = pin.kind === 'client' ? pin.data : null;
  const event = pin.kind === 'event' ? pin.data : null;
  const delivery = pin.kind === 'delivery' ? pin.data : null;
  const Icon = event?.eventType === 'stop' ? Pause : event?.eventType === 'signal_gap' ? Radio : event ? Zap : MapPin;
  const title = client?.name ?? event?.title ?? (event ? eventNames[event.eventType] : delivery?.clientName);
  const badge = client ? client.code ? ({ active: 'Activo', warning: 'En observación', dormant: 'Sin actividad' }[client.status]) : 'Destino de entrega'
    : event ? 'Registro GPS' : `Parada ${delivery?.sequence}`;
  const rows: [string, string][] = client && client.code ? [
    ['Última visita', elapsed(client.daysSinceVisit)], ['Última compra', elapsed(client.daysSincePurchase)],
    ['Despacho', client.hasPendingOrder ? 'Pedido pendiente' : 'Sin pedido pendiente'],
    ['Visita de hoy', client.visitedToday ? 'Registrada' : 'Sin registro'],
    ...(client.salesRep ? [['Ejecutivo', client.salesRep] as [string, string]] : []),
  ] : event ? [
    ['Inicio', dateTime(event.at)], ...(event.endedAt ? [['Fin', dateTime(event.endedAt)] as [string, string]] : []),
    ...(event.vehiclePlate ? [['Vehículo', event.vehiclePlate] as [string, string]] : []),
  ] : delivery ? [
    ['Ruta', pin.kind === 'delivery' ? pin.routeCode : ''],
    ['Estado', delivery.status.replaceAll('_', ' ')],
    ['Llegada prevista', dateTime(delivery.plannedArrivalAt)],
    ['Llegada registrada', dateTime(delivery.actualArrivalAt)],
  ] : [];
  return <section role="tooltip" aria-label={title} className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-[0_12px_40px_rgba(15,23,42,0.22)]">
    <div className={`flex items-start gap-3 border-b border-slate-100 bg-slate-50 px-4 ${compact ? 'py-2' : 'py-3'}`}>
      <span className={`mt-0.5 rounded-xl p-2 ${event?.eventType === 'signal_gap' || event?.eventType === 'speeding' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}><Icon size={18} /></span>
      <div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{badge}{client?.code ? ` · ${client.code}` : ''}</div><h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-tight">{title}</h3></div>
    </div>
    <div className={`px-4 ${compact ? 'space-y-2 py-2' : 'space-y-3 py-3'}`}>
      {client || delivery ? <p className="line-clamp-2 text-xs leading-relaxed text-slate-600">{client?.addressLine ?? delivery?.addressLine}{client?.communeName ? ` · ${client.communeName}` : ''}</p> : null}
      {event?.detail ? <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800"><Clock3 size={14} />{event.detail}</div> : null}
      {rows.length ? <dl className={compact ? 'space-y-1' : 'space-y-2'}>{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 text-xs"><dt className="shrink-0 text-slate-500">{label}</dt><dd className="min-w-0 break-words text-right font-medium">{value}</dd></div>)}</dl> : null}
      <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400"><Navigation size={11} />{pin.data.lat.toFixed(6)}, {pin.data.lng.toFixed(6)}</div>
      {event?.eventType === 'signal_gap' ? <p className="text-[10px] leading-relaxed text-amber-700">La ubicación corresponde al último registro. El recorrido durante este intervalo no está confirmado.</p> : null}
    </div>
  </section>;
}

/** React renders provider text safely; Popup keeps the card anchored and flips at edges. */
export function MapPinCard({ map, pin }: { map: MapLibreMap; pin: MapPin }) {
  return <MapAnchoredCard map={map} position={pin.data} offset={pin.kind === 'client' ? 48 : 18}>
    {(compact) => <PinCardContent pin={pin} compact={compact} />}
  </MapAnchoredCard>;
}
