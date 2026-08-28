'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Alert } from '@/types/core';

const SEVERITY_TONE = {
  critical: 'danger',
  warning: 'warning',
  info: 'brand',
} as const;

const SEVERITY_LABEL = {
  critical: 'Critica',
  warning: 'Advertencia',
  info: 'Informativa',
} as const;

/** Campana de alertas con vista rapida de las mas recientes sin resolver. */
export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['alerts', 'summary'],
    refetchInterval: 45_000,
    queryFn: async (): Promise<{ alerts: Alert[] }> => {
      const response = await fetch('/api/alertas');
      if (!response.ok) throw new Error('Alertas no disponibles');
      return (await response.json()) as { alerts: Alert[] };
    },
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openAlerts = (data?.alerts ?? []).filter((a) => a.state !== 'resuelta');
  const criticalCount = openAlerts.filter((a) => a.severity === 'critical').length;
  const count = openAlerts.length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Alertas${count > 0 ? `: ${count} sin resolver` : ''}`}
        className="tap relative flex items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-800 hover:text-ink sm:h-9 sm:w-9 sm:min-h-0 sm:min-w-0"
      >
        <Bell className="h-4.5 w-4.5" width={18} height={18} />
        {count > 0 ? (
          <span
            className={cn(
              'absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white sm:right-0.5 sm:top-0.5',
              criticalCount > 0 ? 'bg-status-dormant' : 'bg-status-warning',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-[340px] max-w-[calc(100vw-1.5rem)] animate-slide-up overflow-hidden rounded-lg border border-line-strong bg-surface-850 shadow-panel">
          <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
            <p className="text-[13px] font-semibold text-ink">Alertas sin resolver</p>
            <Badge tone={criticalCount > 0 ? 'danger' : 'neutral'}>{count}</Badge>
          </div>

          {openAlerts.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-faint">
              No hay alertas pendientes. La operacion esta dentro de los parametros definidos.
            </p>
          ) : (
            <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">
              {openAlerts.slice(0, 8).map((alert) => (
                <li key={alert.id}>
                  <Link
                    prefetch={false}
                    href={`/alertas?alerta=${encodeURIComponent(alert.id)}`}
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-surface-800"
                  >
                    <AlertTriangle
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        alert.severity === 'critical'
                          ? 'text-status-dormant'
                          : alert.severity === 'warning'
                            ? 'text-status-warning'
                            : 'text-brand-700',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-ink">{alert.title}</span>
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-2xs leading-relaxed text-ink-faint">
                        {alert.description}
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <Badge tone={SEVERITY_TONE[alert.severity]} size="sm">
                          {SEVERITY_LABEL[alert.severity]}
                        </Badge>
                        <span className="text-2xs text-ink-faint">{formatRelative(alert.timestamp)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <Link
            href="/alertas"
            onClick={() => setOpen(false)}
            className="block border-t border-line px-3 py-2.5 text-center text-xs font-medium text-brand-700 transition-colors hover:bg-surface-800"
          >
            Ver centro de alertas
          </Link>
        </div>
      ) : null}
    </div>
  );
}
