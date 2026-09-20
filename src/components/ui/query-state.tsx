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
    <div className="flex items-center gap-3 rounded-xl border border-status-warning/30 bg-status-warning/10 px-3.5 py-2.5 shadow-float">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-warning/15 text-status-warning">
        <WifiOff className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 text-xs text-ink">
        Conexion GPS temporalmente no disponible.{' '}
        {lastKnownAt ? (
          <span className="text-ink-muted">
            Ultimos datos conocidos: {formatTimeWithSeconds(lastKnownAt)}.
          </span>
        ) : null}
      </p>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Cerrar aviso"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-ink-faint hover:bg-status-warning/15 hover:text-ink"
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
    <div className="flex items-start gap-3 rounded-xl border border-brand-500/25 bg-brand-500/5 px-3.5 py-2.5 shadow-float">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-700">
        <Info className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 text-xs text-ink-muted">
        <span className="font-medium text-brand-700">Disponible al conectar fuente externa.</span>{' '}
        {what}
      </p>
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
