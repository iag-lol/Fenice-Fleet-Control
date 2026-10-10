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
import { DEFAULT_OPERATIONAL_SETTINGS, type OperationalSettings } from '@/config/operational';
import { liveGpsConnection } from '@/lib/engines/live-gps-health';

interface SystemModeResponse extends SystemModeInfo {
  settings: OperationalSettings;
}

/**
 * Indicador de estado de la telemetria.
 *
 * Muestra el modo del proveedor (DEMO o CONECTADO), el transporte real en uso
 * y la antiguedad de la ultima posicion, con el escalonamiento configurado:
 * advertencia, posible perdida de senal y offline.
 */
export function GpsStatusIndicator({ compact }: { compact?: boolean }) {
  const { transport, error, lastUpdateAt, sourceResponding, isPaused, refresh, payload } = useLiveFleet();
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

  const simulated = mode?.gps.simulated ?? false;
  const activeDevices = payload?.vehicles.filter(v => v.vehicle.active && v.device?.communication === 'online').length ?? 0;
  const knownDevices = payload?.vehicles.filter(v => v.vehicle.active && v.device).length ?? 0;
  const communicating = sourceResponding && activeDevices > 0;
  const waitingDevices = payload?.vehicles.filter(v => v.vehicle.active && v.device?.communication === 'standby').length ?? 0;
  const waiting = sourceResponding && knownDevices > 0 && waitingDevices === knownDevices;

  // El escalonamiento es el mismo que aplican los motores del servidor.
  const connection = liveGpsConnection(secondsSinceUpdate, sourceResponding, error !== null,
    mode?.settings.gps ?? DEFAULT_OPERATIONAL_SETTINGS.gps);
  const severity = waiting ? 'standby' : communicating ? 'ok' : connection === 'online' ? 'ok' : connection === 'stale' ? 'warning'
    : connection === 'offline' ? 'critical' : connection;

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
    waiting ? 'En espera'
    : communicating && connection !== 'online'
      ? knownDevices > 1 ? `${activeDevices}/${knownDevices} en línea` : 'Equipo en línea'
    : severity === 'critical'
      ? !sourceResponding && error ? 'Consulta GPS interrumpida' : 'Sin GPS reciente'
      : severity === 'lost'
        ? 'Sin ubicación reciente'
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
          mode?.gps.provider === 'unavailable'
            ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
            : simulated
            ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
            : 'border-status-active/30 bg-status-active/10 text-status-active',
        )}
        title={
          simulated
            ? 'Telemetria generada por el simulador integrado.'
            : mode?.gps.provider === 'unavailable' ? 'Proveedor GPS sin conexion. Revisa la prueba en Configuracion.'
            : 'Proveedor GPS real configurado. El estado de señal se muestra junto a la ultima actualizacion.'
        }
      >
        <Satellite className="h-3 w-3" />
        GPS: {mode?.gps.label ?? 'CARGANDO'}
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
          <Wifi className={cn('h-3 w-3', severity === 'standby' ? 'text-ink-faint' : severity === 'ok' ? 'text-status-active' : 'text-status-warning')} />
        )}
        <span className="hidden text-ink-muted sm:inline">Ultima actualizacion</span>
        <span
          className={cn(
            'numeric font-medium',
            severity === 'ok' || severity === 'standby'
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
