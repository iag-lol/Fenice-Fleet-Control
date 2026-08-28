'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  Navigation,
  Phone,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatNumber, formatSmartDateTime, formatTime } from '@/lib/format';
import type { DriverStop } from '@/types/core';
import { DeliveryForm } from './delivery-form';
import { useDriverSession } from './use-driver-session';

/**
 * Portal del conductor.
 *
 * Es la unica pantalla del sistema pensada para usarse en movimiento: texto
 * grande, un objetivo tactil por decision y la proxima parada siempre arriba.
 * No hay menu ni navegacion lateral porque el conductor solo tiene una tarea.
 */

function StopBadge({ stop, queued }: { stop: DriverStop; queued: boolean }) {
  if (queued) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/12 px-2 py-0.5 text-[11px] font-semibold text-status-warning">
        <CloudOff className="h-3 w-3" /> Por enviar
      </span>
    );
  }
  if (stop.status === 'completada' || stop.status === 'visita_detectada') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-active/12 px-2 py-0.5 text-[11px] font-semibold text-status-active">
        <CheckCircle2 className="h-3 w-3" /> Entregada
      </span>
    );
  }
  if (stop.status === 'incidencia') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-dormant/12 px-2 py-0.5 text-[11px] font-semibold text-status-dormant">
        <AlertTriangle className="h-3 w-3" /> Incidencia
      </span>
    );
  }
  if (stop.insideGeofence) {
    return (
      <span className="rounded-full bg-brand-500/12 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
        En el lugar
      </span>
    );
  }
  return null;
}

export function DriverRouteView({ token }: { token: string }) {
  const state = useDriverSession(token);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);

  const queuedIds = useMemo(
    () => new Set(state.pending.map((delivery) => delivery.workOrderId)),
    [state.pending],
  );

  const activeStop = state.session?.stops.find((stop) => stop.workOrderId === activeStopId) ?? null;

  if (state.loading) {
    return (
      <div className="flex min-h-app items-center justify-center bg-surface-950 px-6 text-center">
        <p className="text-sm text-ink-faint">Cargando tu ruta…</p>
      </div>
    );
  }

  if (state.error !== null && state.session === null) {
    return (
      <div className="flex min-h-app flex-col items-center justify-center gap-3 bg-surface-950 px-6 text-center">
        <AlertTriangle className="h-10 w-10 text-status-warning" />
        <p className="text-[15px] font-semibold text-ink">{state.error}</p>
        <p className="max-w-xs text-sm leading-relaxed text-ink-faint">
          {state.expired
            ? 'Los enlaces caducan al terminar la jornada por seguridad.'
            : 'Abre el enlace tal como te llego, sin recortarlo.'}
        </p>
      </div>
    );
  }

  const session = state.session;
  if (!session) return null;

  const progress = session.totalStops === 0 ? 0 : (session.completedStops + session.incidentStops) / session.totalStops;

  return (
    <div className="min-h-app bg-surface-950 pb-8">
      <header className="sticky top-0 z-20 border-b border-line bg-surface-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{session.routeName}</p>
            <p className="truncate text-xs text-ink-faint">
              {session.vehiclePlate ?? 'Sin vehiculo'}
              {session.driverName ? ` · ${session.driverName}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void state.refresh()}
            aria-label="Actualizar"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-800"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-750">
            <div
              className="h-full rounded-full bg-status-active transition-[width] duration-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums text-ink-muted">
            {session.completedStops + session.incidentStops}/{session.totalStops}
          </span>
        </div>

        <p className="mt-2 text-xs text-ink-faint">
          {formatNumber(session.totalLiters)} L en ruta
          {session.vehicleCapacityLiters
            ? ` · estanque de ${formatNumber(session.vehicleCapacityLiters)} L`
            : ''}
          {session.incidentStops > 0
            ? ` · ${session.incidentStops} con incidencia`
            : ''}
        </p>
      </header>

      {!state.online || state.pending.length > 0 ? (
        <div className="flex items-center gap-2 border-b border-status-warning/25 bg-status-warning/8 px-4 py-2.5">
          <CloudOff className="h-4 w-4 shrink-0 text-status-warning" />
          <p className="text-xs leading-snug text-ink-muted">
            {state.pending.length > 0
              ? `${state.pending.length} entrega${state.pending.length === 1 ? '' : 's'} guardada${state.pending.length === 1 ? '' : 's'} en el telefono. Se enviara${state.pending.length === 1 ? '' : 'n'} sola${state.pending.length === 1 ? '' : 's'} al recuperar senal.`
              : 'Sin conexion. Puedes seguir registrando entregas: quedan guardadas.'}
          </p>
        </div>
      ) : null}

      <ul className="space-y-2 p-3">
        {session.stops.map((stop) => {
          const queued = queuedIds.has(stop.workOrderId);
          const closed = !stop.actionable || queued;
          const isNext = stop.sequence === session.nextStopSequence && !queued;

          return (
            <li key={stop.workOrderId}>
              <div
                className={`rounded-xl border bg-surface-900 p-3 shadow-card ${
                  isNext ? 'border-brand-500 ring-1 ring-brand-500/25' : 'border-line'
                } ${closed ? 'opacity-70' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                      closed ? 'bg-surface-750 text-ink-faint' : 'bg-brand-600 text-white'
                    }`}
                  >
                    {stop.sequence}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[15px] font-semibold text-ink">{stop.clientName}</p>
                      <StopBadge stop={stop} queued={queued} />
                    </div>
                    <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
                      {stop.addressLine}, {stop.communeName}
                    </p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {formatNumber(stop.totalLiters)} L
                      {stop.scheduledWindowStart
                        ? ` · ventana ${formatTime(stop.scheduledWindowStart)}–${formatTime(stop.scheduledWindowEnd)}`
                        : ''}
                    </p>

                    {stop.lines.length > 0 ? (
                      <ul className="mt-2 space-y-0.5">
                        {stop.lines.map((line) => (
                          <li key={`${line.productName}-${line.compartment ?? 0}`} className="text-xs text-ink-muted">
                            <span className="tabular-nums font-semibold">{formatNumber(line.liters)} L</span>{' '}
                            {line.productName}
                            {line.compartment !== null ? ` · comp. ${line.compartment}` : ''}
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {stop.notes ? (
                      <p className="mt-2 rounded-md bg-surface-800 px-2 py-1.5 text-xs leading-snug text-ink-muted">
                        {stop.notes}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 flex gap-2">
                  {stop.coordinates ? (
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${stop.coordinates.lat},${stop.coordinates.lng}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface-900 text-sm font-medium text-ink-muted"
                    >
                      <Navigation className="h-4 w-4" /> Navegar
                    </a>
                  ) : null}
                  {stop.contactPhone ? (
                    <a
                      href={`tel:${stop.contactPhone}`}
                      aria-label={`Llamar a ${stop.contactName ?? stop.clientName}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-900 text-ink-muted"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  ) : null}
                  {stop.actionable && !queued ? (
                    <Button
                      variant={isNext ? 'primary' : 'secondary'}
                      className="h-11 min-w-0 flex-1"
                      onClick={() => setActiveStopId(stop.workOrderId)}
                    >
                      Cerrar parada <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="px-4 pb-2 text-center text-[11px] leading-relaxed text-ink-faint">
        Este enlace es personal y caduca el {formatSmartDateTime(session.tokenExpiresAt)}.
        No lo reenvies.
      </p>

      {activeStop ? (
        <DeliveryForm
          stop={activeStop}
          limits={state.limits}
          submitting={state.submitting}
          onCancel={() => setActiveStopId(null)}
          onSubmit={async (input) => {
            const result = await state.submitDelivery(input);
            setActiveStopId(null);
            return result;
          }}
        />
      ) : null}
    </div>
  );
}
