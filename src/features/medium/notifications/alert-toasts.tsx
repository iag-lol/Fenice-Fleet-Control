'use client';

import { AlertTriangle, Bell, BellOff, Info, Truck, Volume2, VolumeX, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

import { primeAlertSound } from '@/lib/alert-sound';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AlertSeverity } from '@/types/core';
import { useAlertNotifications } from './use-alert-notifications';

/**
 * Alertas flotantes.
 *
 * Aparecen sobre la pantalla en la que se este trabajando, porque una alerta
 * util es la que interrumpe: obligar a ir al centro de alertas para
 * enterarse es lo mismo que no avisar.
 *
 * Cada tarjeta dice QUE paso, A QUIEN afecta y CUANDO, y lleva un enlace
 * directo al lugar donde se resuelve. Una alerta sin destino es solo ruido.
 */

const ESTILO: Record<AlertSeverity, { borde: string; chip: string; icono: typeof AlertTriangle }> = {
  critical: {
    borde: 'border-status-dormant/50 bg-surface-900',
    chip: 'bg-status-dormant text-white',
    icono: AlertTriangle,
  },
  warning: {
    borde: 'border-status-warning/50 bg-surface-900',
    chip: 'bg-status-warning text-white',
    icono: AlertTriangle,
  },
  info: {
    borde: 'border-line bg-surface-900',
    chip: 'bg-surface-750 text-ink-muted',
    icono: Info,
  },
};

const ETIQUETA: Record<AlertSeverity, string> = {
  critical: 'Critica',
  warning: 'Advertencia',
  info: 'Informativa',
};

export function AlertToasts() {
  const { visible, dismiss, dismissAll, preferences, setPreferences, permission, requestPermission } =
    useAlertNotifications();

  /**
   * Los navegadores solo autorizan el audio despues de una interaccion real.
   * Se aprovecha el primer clic o pulsacion en cualquier parte para dejar el
   * contexto listo, de modo que la primera alerta ya suene.
   */
  useEffect(() => {
    const preparar = (): void => primeAlertSound();
    window.addEventListener('pointerdown', preparar, { once: true });
    window.addEventListener('keydown', preparar, { once: true });
    return () => {
      window.removeEventListener('pointerdown', preparar);
      window.removeEventListener('keydown', preparar);
    };
  }, []);

  if (visible.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Alertas recientes"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-2.5 bottom-[72px] z-[70] flex flex-col gap-2 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[380px] md:bottom-4"
    >
      {visible.length > 1 ? (
        <div className="pointer-events-auto flex items-center justify-between gap-2 self-end rounded-md border border-line bg-surface-900/95 px-2.5 py-1 shadow-float backdrop-blur">
          <span className="text-2xs text-ink-faint">{visible.length} alertas nuevas</span>
          <button
            type="button"
            onClick={dismissAll}
            className="text-2xs font-semibold text-brand-700 hover:underline"
          >
            Descartar todas
          </button>
        </div>
      ) : null}

      {visible.map((alerta) => {
        const estilo = ESTILO[alerta.severity];
        const Icono = estilo.icono;

        return (
          <article
            key={alerta.id}
            className={cn(
              'pointer-events-auto animate-slide-up rounded-xl border shadow-panel backdrop-blur',
              estilo.borde,
            )}
          >
            <div className="flex items-start gap-3 p-3">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  estilo.chip,
                )}
              >
                <Icono className="h-4.5 w-4.5" width={18} height={18} />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      estilo.chip,
                    )}
                  >
                    {ETIQUETA[alerta.severity]}
                  </span>
                  <span className="truncate text-2xs text-ink-faint">
                    {formatRelative(alerta.timestamp)}
                  </span>
                </div>

                <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">
                  {alerta.title}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-muted">
                  {alerta.description}
                </p>

                {/* A quien afecta: sin esto el operador tiene que buscarlo. */}
                {alerta.vehiclePlate || alerta.clientName ? (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-ink-faint">
                    {alerta.vehiclePlate ? (
                      <span className="numeric inline-flex items-center gap-1">
                        <Truck className="h-3 w-3" />
                        {alerta.vehiclePlate}
                      </span>
                    ) : null}
                    {alerta.clientName ? <span className="truncate">{alerta.clientName}</span> : null}
                  </p>
                ) : null}

                <div className="mt-2 flex items-center gap-3">
                  <Link
                    href={`/alertas?alerta=${encodeURIComponent(alerta.id)}`}
                    onClick={() => dismiss(alerta.id)}
                    className="inline-flex min-h-11 items-center text-2xs font-semibold text-brand-700 hover:underline sm:min-h-9"
                  >
                    Ver y resolver
                  </Link>
                  {alerta.vehicleId ? (
                    <Link
                      href={`/flota/${alerta.vehicleId}`}
                      onClick={() => dismiss(alerta.id)}
                      className="inline-flex min-h-11 items-center text-2xs font-medium text-ink-muted hover:text-ink sm:min-h-9"
                    >
                      Abrir vehiculo
                    </Link>
                  ) : null}
                </div>
              </div>

              <button
                type="button"
                onClick={() => dismiss(alerta.id)}
                aria-label="Descartar alerta"
                className="-mr-1 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-faint hover:bg-surface-800 hover:text-ink sm:h-9 sm:w-9"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Controles al alcance: si el aviso molesta, se apaga aqui mismo
                en vez de obligar a buscarlo en Configuracion. */}
            <div className="flex items-center gap-1 border-t border-line px-2 py-1">
              <button
                type="button"
                onClick={() => setPreferences({ sound: !preferences.sound })}
                aria-label={preferences.sound ? 'Silenciar avisos' : 'Activar sonido'}
                className="flex h-11 w-11 items-center justify-center rounded text-ink-faint hover:bg-surface-800 hover:text-ink sm:h-9 sm:w-9"
              >
                {preferences.sound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              </button>

              {permission === 'granted' ? (
                <button
                  type="button"
                  onClick={() => setPreferences({ desktop: !preferences.desktop })}
                  className="flex min-h-11 items-center gap-1.5 rounded px-2 text-2xs text-ink-faint hover:bg-surface-800 hover:text-ink sm:min-h-9"
                >
                  {preferences.desktop ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                  {preferences.desktop ? 'Avisos del sistema activos' : 'Avisos del sistema apagados'}
                </button>
              ) : permission === 'default' ? (
                <button
                  type="button"
                  onClick={() => void requestPermission()}
                  className="flex min-h-11 items-center gap-1.5 rounded px-2 text-2xs font-medium text-brand-700 hover:bg-surface-800 sm:min-h-9"
                >
                  <Bell className="h-3.5 w-3.5" />
                  Avisarme aunque no tenga la pestaña abierta
                </button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
