'use client';

import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Radio, Satellite, Wifi, WifiOff } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { GPS_TRANSPORT_LABEL } from '@/services/gps/client/http-gps-provider';
import { useLiveFleet, useSecondsSince } from '@/hooks/use-live-fleet';
import { formatElapsed, formatTimeWithSeconds } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { SystemModeInfo } from '@/services/registry';

interface SystemModeResponse extends SystemModeInfo {
  settings: unknown;
}

/**
 * Indicador de estado de la telemetria.
 *
 * Muestra el modo del proveedor (DEMO o CONECTADO), el transporte real en uso
 * y la antiguedad de la ultima posicion, con el escalonamiento configurado:
 * advertencia, posible perdida de senal y offline.
 */
export function GpsStatusIndicator({ compact }: { compact?: boolean }) {
  const { transport, error, lastUpdateAt, isPaused, refresh } = useLiveFleet();
  const secondsSinceUpdate = useSecondsSince(lastUpdateAt);
  const [busy, setBusy] = useState(false);

  const { data: mode } = useQuery({
    queryKey: ['system', 'mode'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SystemModeResponse> => {
      const response = await fetch('/api/system/mode');
      if (!response.ok) throw new Error('Estado del sistema no disponible');
      return (await response.json()) as SystemModeResponse;
    },
  });

  const toggleSimulator = useCallback(async () => {
    setBusy(true);
    try {
      await fetch('/api/simulator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: isPaused ? 'resume' : 'pause' }),
      });
      refresh();
    } finally {
      setBusy(false);
    }
  }, [isPaused, refresh]);

  const simulated = mode?.gps.simulated ?? true;

  // El escalonamiento es el mismo que aplican los motores del servidor.
  const severity =
    error !== null
      ? 'critical'
      : secondsSinceUpdate === null
        ? 'unknown'
        : secondsSinceUpdate > 600
          ? 'critical'
          : secondsSinceUpdate > 180
            ? 'lost'
            : secondsSinceUpdate > 60
              ? 'warning'
              : 'ok';

  const tone =
    severity === 'ok'
      ? 'active'
      : severity === 'warning'
        ? 'warning'
        : severity === 'lost'
          ? 'warning'
          : severity === 'critical'
            ? 'danger'
            : 'neutral';

  const label =
    severity === 'critical'
      ? 'Sin senal'
      : severity === 'lost'
        ? 'Posible perdida de senal'
        : severity === 'warning'
          ? 'Senal retrasada'
          : severity === 'unknown'
            ? 'Conectando'
            : formatElapsed(secondsSinceUpdate);

  if (compact) {
    return (
      <Badge tone={tone} dot title={`Transporte: ${GPS_TRANSPORT_LABEL[transport]}`}>
        {label}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {/* Indicador de modo: discreto pero siempre visible. */}
      <span
        className={cn(
          'hidden items-center gap-1.5 rounded border px-2 py-1 text-2xs font-semibold uppercase tracking-wide lg:inline-flex',
          simulated
            ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
            : 'border-status-active/30 bg-status-active/10 text-status-active',
        )}
        title={
          simulated
            ? 'Telemetria generada por el simulador integrado. Configura GPS_PROVIDER=traccar para usar el servidor GPS real.'
            : 'Conectado al servidor GPS.'
        }
      >
        <Satellite className="h-3 w-3" />
        GPS: {mode?.gps.label ?? 'DEMO'}
      </span>

      <span
        className="flex items-center gap-1.5 rounded border border-line bg-surface-850 px-2 py-1 text-2xs"
        title={`Transporte: ${GPS_TRANSPORT_LABEL[transport]}${lastUpdateAt ? ` · ${formatTimeWithSeconds(lastUpdateAt)}` : ''}`}
      >
        {severity === 'critical' ? (
          <WifiOff className="h-3 w-3 text-status-dormant" />
        ) : transport === 'sse' || transport === 'websocket' ? (
          <Radio className={cn('h-3 w-3', severity === 'ok' ? 'text-status-active' : 'text-status-warning')} />
        ) : (
          <Wifi className={cn('h-3 w-3', severity === 'ok' ? 'text-status-active' : 'text-status-warning')} />
        )}
        <span className="hidden text-ink-muted sm:inline">Ultima actualizacion</span>
        <span
          className={cn(
            'numeric font-medium',
            severity === 'ok'
              ? 'text-ink'
              : severity === 'critical'
                ? 'text-status-dormant'
                : 'text-status-warning',
          )}
        >
          {label}
        </span>
      </span>

      {simulated ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void toggleSimulator()}
          loading={busy}
          title={isPaused ? 'Reanudar simulacion GPS' : 'Pausar simulacion GPS'}
          aria-label={isPaused ? 'Reanudar simulacion GPS' : 'Pausar simulacion GPS'}
        >
          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
    </div>
  );
}
