'use client';

import { ChevronDown, ChevronUp, Clock3, Crosshair, Droplets, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { WorkOrderDownload } from '@/components/orders/work-order-download';
import { cn } from '@/lib/cn';
import { deliveryClock } from '@/lib/engines/active-delivery';
import { formatNumber, formatTime } from '@/lib/format';
import type { ActiveDelivery } from '@/types/views';

const sessionKey = (delivery: ActiveDelivery) => `${delivery.vehicleId}:${delivery.workOrderId}:${delivery.enteredAt}`;
const elapsed = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  return `${hours ? `${hours}:` : ''}${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/** One compact map control, regardless of how many trucks are delivering. */
export function ActiveDeliveryDock({ deliveries, observedAt, className, bottom, onLocateVehicle }: {
  deliveries: ActiveDelivery[]; observedAt: (vehicleId: string) => string | undefined; className?: string; bottom?: number;
  onLocateVehicle?: (vehicleId: string) => void;
}) {
  const [chosenSession, setChosenSession] = useState<string | null>(null);
  const [collapsedSession, setCollapsedSession] = useState<string | null>(null);
  const [expandedSession, setExpandedSession] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  const delivery = deliveries.find((item) => sessionKey(item) === chosenSession) ??
    [...deliveries].sort((a, b) => Date.parse(b.enteredAt) - Date.parse(a.enteredAt))[0];
  if (!delivery) return null;
  const key = sessionKey(delivery);
  const clock = deliveryClock(delivery, now, observedAt(delivery.vehicleId));
  const expanded = expandedSession === key;
  const collapsed = collapsedSession === key;

  return <div data-testid="active-delivery-dock" style={bottom === undefined ? undefined : { bottom }} className={cn('pointer-events-none absolute bottom-8 left-3 z-10 w-[272px] max-w-[calc(100%-24px)]', className)}>
    <section aria-label={`Entrega activa a ${delivery.clientName}`} onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}
      className="pointer-events-auto overflow-hidden rounded-xl border border-emerald-200 bg-white/95 text-slate-900 shadow-lg backdrop-blur-sm">
      {collapsed ? <button type="button" onClick={() => setCollapsedSession(null)} aria-label="Mostrar entrega activa" className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Droplets className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{delivery.vehiclePlate} · Entrega en curso</span>
        {deliveries.length > 1 ? <span className="rounded bg-emerald-50 px-1.5 text-[10px] text-emerald-700">{deliveries.length}</span> : null}
        <ChevronUp size={13} className="text-slate-500" />
      </button> : <>
        <header className="border-b border-emerald-100 bg-emerald-50/80 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider ${clock.stale ? 'text-amber-700' : 'text-emerald-700'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${clock.stale ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              {clock.stale ? 'Presencia por verificar' : delivery.workOrderStatus === 'completada' ? 'Entrega registrada' : 'Atención en curso'}
            </span>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => onLocateVehicle?.(delivery.vehicleId)} aria-label={`Centrar vehículo ${delivery.vehiclePlate}`} title="Centrar vehículo en el mapa" className="rounded p-0.5 text-emerald-600 hover:bg-white hover:text-emerald-800"><Crosshair size={13} /></button>
              <button type="button" onClick={() => setCollapsedSession(key)} aria-label="Minimizar tarjeta de entrega" className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-slate-700"><X size={13} /></button>
            </div>
          </div>
          {deliveries.length > 1 ? <select aria-label="Seleccionar entrega activa" value={key} onChange={(event) => {
            const selected = deliveries.find((item) => sessionKey(item) === event.target.value);
            if (!selected) return;
            setChosenSession(sessionKey(selected));
            onLocateVehicle?.(selected.vehicleId);
          }}
            className="mt-1 block h-6 w-full min-w-0 rounded border border-emerald-200 bg-white px-1.5 text-[11px] font-semibold text-slate-800">
            {deliveries.map((item) => <option key={sessionKey(item)} value={sessionKey(item)}>{item.vehiclePlate} · {item.clientName}</option>)}
          </select> : <h3 className="mt-1 truncate text-xs font-semibold" title={delivery.clientName}>{delivery.clientName}</h3>}
          <p className="mt-0.5 truncate text-[10px] text-slate-500">{delivery.vehiclePlate} · {delivery.workOrderNumber}</p>
        </header>
        <div className="px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-[9px] text-slate-500">Litros de la OT</p><p className="text-base font-bold leading-tight text-emerald-800">{delivery.totalLiters === null ? 'Sin detalle' : `${formatNumber(delivery.totalLiters)} L`}</p></div>
            <div className="text-right"><p className="flex items-center justify-end gap-1 text-[9px] text-slate-500"><Clock3 size={10} />Detenido</p><p className="font-mono text-sm font-semibold leading-tight">{clock.stoppedSeconds === null ? '--:--' : elapsed(clock.stoppedSeconds)}</p></div>
          </div>
          <p className="mt-1 truncate text-[10px] text-slate-500" title={delivery.lines?.map((line) => line.productName).join(' · ')}>{delivery.lines?.map((line) => line.productName).join(' · ') || 'Productos no disponibles'}</p>
          {clock.stale ? <p role="status" className="mt-1 text-[10px] text-amber-700">GPS atrasado · contador pausado</p> : null}
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <Link href={`/clientes/${encodeURIComponent(delivery.clientId)}`} className="flex h-7 items-center justify-center gap-1 rounded-md bg-emerald-700 px-2 text-[10px] font-semibold text-white hover:bg-emerald-800"><ExternalLink size={11} />Ficha cliente</Link>
            <WorkOrderDownload key={delivery.workOrderId} workOrderId={delivery.workOrderId} number={delivery.workOrderNumber} compact />
          </div>
          <div className="mt-1.5 flex items-center justify-between">
            <button type="button" aria-expanded={expanded} onClick={() => setExpandedSession(expanded ? null : key)} className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-emerald-700">
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}{expanded ? 'Menos detalle' : 'Más detalle'}
            </button>
            <Link href={`/ordenes/${encodeURIComponent(delivery.workOrderId)}`} className="text-[10px] font-medium text-slate-500 hover:text-emerald-700">Ver OT →</Link>
          </div>
          {expanded ? <div className="mt-2 max-h-[120px] space-y-1.5 overflow-y-auto border-t border-slate-100 pt-2 text-[10px] text-slate-500">
            <p>{delivery.addressLine} · {delivery.communeName}</p>
            <p>{delivery.arrivalObserved ? 'Llegada' : 'Primer registro'}: {formatTime(delivery.enteredAt)}</p>
            {delivery.lines?.map((line, index) => <p key={index} className="flex justify-between gap-2"><span>{line.productName}</span><span className="shrink-0 font-medium">{formatNumber(line.liters)} L</span></p>)}
            <p className="text-[9px]">Volumen programado en la OT. El GPS no mide la descarga.</p>
          </div> : null}
        </div>
      </>}
    </section>
  </div>;
}
