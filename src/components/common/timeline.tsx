'use client';

import {
  ArrowRightLeft,
  CircleDot,
  Flag,
  LogIn,
  LogOut,
  MapPin,
  PauseCircle,
  Radio,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { TimelineEntry, TimelineEntryKind } from '@/types/views';

const KIND_ICON: Record<TimelineEntryKind, typeof CircleDot> = {
  ruta_inicio: Flag,
  geocerca_entrada: LogIn,
  geocerca_salida: LogOut,
  visita_confirmada: ShieldCheck,
  detencion: PauseCircle,
  desvio: ArrowRightLeft,
  retorno_ruta: CircleDot,
  evento_gps: Radio,
  ruta_fin: Flag,
};

const KIND_COLOR: Record<TimelineEntryKind, string> = {
  ruta_inicio: 'text-brand-700',
  geocerca_entrada: 'text-brand-700',
  geocerca_salida: 'text-ink-faint',
  visita_confirmada: 'text-status-active',
  detencion: 'text-status-warning',
  desvio: 'text-status-warning',
  retorno_ruta: 'text-status-active',
  evento_gps: 'text-status-dormant',
  ruta_fin: 'text-status-active',
};

export interface TimelineProps {
  entries: TimelineEntry[];
  /** Centrar el mapa en el evento seleccionado. */
  onFocus?: (entry: TimelineEntry) => void;
  emptyMessage?: string;
}

/**
 * Linea de tiempo del vehiculo. Cada evento con posicion permite centrar el
 * mapa: es la forma en que el operador reconstruye lo que ocurrio.
 */
export function Timeline({ entries, onFocus, emptyMessage }: TimelineProps) {
  if (entries.length === 0) {
    return (
      <EmptyState
        compact
        icon={<MapPin className="h-5 w-5" />}
        title="Sin eventos registrados"
        description={
          emptyMessage ??
          'Todavia no hay eventos de geocerca, detenciones ni desvios para esta jornada.'
        }
      />
    );
  }

  return (
    <ol className="relative space-y-0">
      {entries.map((entry, index) => {
        const Icon = KIND_ICON[entry.kind];
        const isLast = index === entries.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Linea vertical que conecta los eventos. */}
            {!isLast ? (
              <span className="absolute left-[13px] top-7 h-[calc(100%-1rem)] w-px bg-line" aria-hidden />
            ) : null}

            <span
              className={cn(
                'relative z-10 mt-0.5 flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border border-line bg-surface-850',
                KIND_COLOR[entry.kind],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="numeric text-xs font-medium text-brand-700">
                  {formatTime(entry.timestamp)}
                </span>
                <span className="text-[13px] text-ink">{entry.title}</span>
              </div>

              {entry.detail ? (
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-faint">{entry.detail}</p>
              ) : null}

              {entry.position && onFocus ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 h-11 px-2 text-2xs sm:h-7"
                  onClick={() => onFocus(entry)}
                >
                  Centrar en el mapa
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
