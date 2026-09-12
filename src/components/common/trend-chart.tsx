'use client';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useState } from 'react';

import { cn } from '@/lib/cn';

export interface TrendPoint {
  date: string;
  completadas: number;
  incidencias: number;
}

/**
 * Tendencia de entregas de la semana.
 *
 * Barras apiladas en HTML en vez de una libreria de graficos: el dato es
 * simple y una dependencia adicional no se justifica. Cada columna es su
 * propio objetivo de foco/hover (teclado incluido) y el tooltip muestra
 * ambas series a la vez: el lector no tiene que acertarle justo al segmento
 * de incidencias, casi siempre el mas angosto de los dos.
 */
export function DeliveryTrendChart({ data, className }: { data: TrendPoint[]; className?: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.completadas + d.incidencias));

  return (
    <div className={className}>
      {/* Fila de barras: el borde inferior es la linea base. Sin ella, una
          barra de 3px (el minimo visual para "hubo algo") es indistinguible
          de cero al ojo. */}
      <div className="flex items-end gap-2 border-b border-line pb-0">
        {data.map((point, index) => {
          const total = point.completadas + point.incidencias;
          const completedHeight = (point.completadas / max) * 100;
          const incidentHeight = (point.incidencias / max) * 100;
          const date = new Date(point.date);
          const active = activeIndex === index;

          return (
            <div
              key={point.date}
              className="group relative flex min-w-0 flex-1 flex-col items-center gap-1.5"
              onPointerEnter={() => setActiveIndex(index)}
              onPointerLeave={() => setActiveIndex((current) => (current === index ? null : current))}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex((current) => (current === index ? null : current))}
              tabIndex={0}
              role="img"
              aria-label={`${format(date, 'EEEE', { locale: es })}: ${point.completadas} completadas, ${point.incidencias} con incidencia`}
            >
              {active ? (
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max min-w-[9rem] -translate-x-1/2 rounded-md border border-line bg-surface-900 px-2.5 py-2 text-left shadow-float">
                  <p className="text-2xs font-semibold capitalize text-ink">
                    {format(date, "EEEE d 'de' MMMM", { locale: es })}
                  </p>
                  <p className="mt-1 flex items-center justify-between gap-3 text-2xs">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <span className="h-2 w-1 rounded-full bg-brand-500" /> Completadas
                    </span>
                    <span className="numeric font-semibold text-ink">{point.completadas}</span>
                  </p>
                  <p className="mt-0.5 flex items-center justify-between gap-3 text-2xs">
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <span className="h-2 w-1 rounded-full bg-status-dormant" /> Incidencias
                    </span>
                    <span className="numeric font-semibold text-ink">{point.incidencias}</span>
                  </p>
                </div>
              ) : null}

              <span className="numeric text-2xs text-ink-faint">{total}</span>

              <div className="flex h-24 w-full max-w-[36px] flex-col justify-end gap-0.5 rounded-sm outline-none ring-brand-400 group-focus-visible:ring-2">
                {incidentHeight > 0 ? (
                  <div
                    className={cn(
                      'w-full rounded-t-sm bg-status-dormant transition-[filter]',
                      active && 'brightness-110',
                    )}
                    style={{ height: `${Math.max(incidentHeight, 3)}%` }}
                  />
                ) : null}
                <div
                  className={cn(
                    'w-full bg-brand-500 transition-[filter]',
                    incidentHeight > 0 ? 'rounded-b-sm' : 'rounded-sm',
                    active && 'brightness-110',
                  )}
                  style={{ height: `${Math.max(completedHeight, total > 0 ? 3 : 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Fila de etiquetas, separada de la fila de barras: as todas quedan
          debajo de la linea base sin desplazarla. */}
      <div className="flex gap-2 pt-1.5">
        {data.map((point, index) => (
          <span
            key={point.date}
            className={cn(
              'min-w-0 flex-1 truncate text-center text-2xs capitalize transition-colors',
              activeIndex === index ? 'font-medium text-ink' : 'text-ink-faint',
            )}
          >
            {format(new Date(point.date), 'EEE', { locale: es })}
          </span>
        ))}
      </div>
    </div>
  );
}
