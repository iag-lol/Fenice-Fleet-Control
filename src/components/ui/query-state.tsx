'use client';

import { AlertTriangle, RotateCw, WifiOff } from 'lucide-react';
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
}: {
  lastKnownAt: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2">
      <WifiOff className="h-4 w-4 shrink-0 text-status-warning" />
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
    </div>
  );
}

/**
 * Marca de funcionalidad que depende de una integracion aun no conectada.
 * La arquitectura interna existe; lo que falta son credenciales externas.
 */
export function PendingIntegrationNotice({ what }: { what: string }) {
  return (
    <div className="rounded-md border border-brand-500/25 bg-brand-500/5 px-3 py-2.5 text-xs text-ink-muted">
      <span className="font-medium text-brand-700">Disponible al conectar fuente externa.</span>{' '}
      {what}
    </div>
  );
}
