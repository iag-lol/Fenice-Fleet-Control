'use client';

import { AlertTriangle, Info, RotateCw, WifiOff, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatTimeWithSeconds } from '@/lib/format';

export interface QueryErrorProps {
  title?: string;
  message?: string;
  /** Ultimo instante con datos validos: da contexto operacional al fallo. */
  lastKnownAt?: string | null;
  onRetry?: () => void;
  compact?: boolean;
}

/**
 * Error de carga de datos.
 *
 * Cuando el problema es la telemetria, se informa la ultima marca conocida:
 * "sin datos" no le sirve a quien esta despachando camiones; "ultimos datos
 * conocidos 06:42:18" si.
 */
export function QueryError({
  title = 'No fue posible cargar la informacion',
  message,
  lastKnownAt,
  onRetry,
  compact,
}: QueryErrorProps) {
  return (
    <div
      className={
        compact
          ? 'flex items-center gap-3 rounded-md border border-status-dormant/25 bg-status-dormant/5 px-3 py-2.5'
          : 'flex flex-col items-center justify-center gap-3 rounded-lg border border-status-dormant/25 bg-status-dormant/5 px-6 py-10 text-center'
      }
      role="alert"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-status-dormant/15 text-status-dormant">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <div className={compact ? 'min-w-0 flex-1' : 'space-y-1'}>
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {message ? <p className="text-xs text-ink-faint">{message}</p> : null}
        {lastKnownAt ? (
          <p className="text-xs text-ink-faint">
            Ultimos datos conocidos: {formatTimeWithSeconds(lastKnownAt)}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" icon={<RotateCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

/** Aviso persistente de degradacion de la senal GPS. */
export function GpsDegradedNotice({
  lastKnownAt,
  onRetry,
  onDismiss,
}: {
  lastKnownAt: string | null;
  onRetry?: () => void;
  /** Si se entrega, muestra una X para colapsar el aviso mientras dure esta misma caida. */
  onDismiss?: () => void;
}) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-amber-300 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2.5 shadow-panel">
      <span aria-hidden className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 min-[360px]:flex">
        <WifiOff className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold leading-5 text-amber-950">
          {lastKnownAt ? 'Sin señal GPS reciente' : 'Esperando una ubicación GPS'}
        </p>
        {lastKnownAt ? <p className="text-[11px] leading-4 text-amber-900">Se conserva la última ubicación.</p> : null}
        {lastKnownAt ? (
          <p className="mt-0.5 text-[11px] leading-4 text-ink-muted">
            Registro: {new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(lastKnownAt))}.
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button size="icon-sm" variant="secondary" onClick={onRetry} aria-label="Reintentar actualización GPS" title="Reintentar actualización GPS" className="shrink-0 border-amber-300 bg-white text-amber-900 hover:bg-amber-100 sm:w-auto sm:px-2.5">
          <RotateCw className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Reintentar</span>
        </Button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-900 hover:bg-amber-100 sm:h-8 sm:w-8"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Marca de funcionalidad que depende de una integracion aun no conectada.
 * La arquitectura interna existe; lo que falta son credenciales externas.
 */
export function PendingIntegrationNotice({
  what,
  onDismiss,
}: {
  what: ReactNode;
  /** Si se entrega, muestra una X para colapsar el aviso mientras dure esta misma condicion. */
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-brand-200 border-l-4 border-l-brand-500 bg-brand-50 px-3.5 py-2.5 shadow-panel">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-800">
        <Info className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink">{what}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-brand-500/15 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}
