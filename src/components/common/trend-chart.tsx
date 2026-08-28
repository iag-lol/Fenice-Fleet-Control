'use client';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';

import { cn } from '@/lib/cn';

export interface TrendPoint {
  date: string;
  completadas: number;
  incidencias: number;
}

/**
 * Tendencia de entregas de la semana.
 *
 * Barras apiladas en SVG en vez de una libreria de graficos: el dato es simple
 * y una dependencia adicional no se justifica.
 */
export function DeliveryTrendChart({ data, className }: { data: TrendPoint[]; className?: string }) {
  const max = Math.max(1, ...data.map((d) => d.completadas + d.incidencias));

  return (
    <div className={cn('flex items-end gap-2', className)}>
      {data.map((point) => {
        const total = point.completadas + point.incidencias;
        const completedHeight = (point.completadas / max) * 100;
        const incidentHeight = (point.incidencias / max) * 100;
        const date = new Date(point.date);

        return (
          <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="numeric text-2xs text-ink-faint">{total}</span>

            <div
              className="flex h-24 w-full max-w-[36px] flex-col justify-end gap-px"
              title={`${point.completadas} completadas, ${point.incidencias} con incidencia`}
            >
              {incidentHeight > 0 ? (
                <div
                  className="w-full rounded-t-sm bg-status-dormant"
                  style={{ height: `${Math.max(incidentHeight, 3)}%` }}
                />
              ) : null}
              <div
                className={cn(
                  'w-full bg-brand-500',
                  incidentHeight > 0 ? 'rounded-b-sm' : 'rounded-sm',
                )}
                style={{ height: `${Math.max(completedHeight, total > 0 ? 3 : 1)}%` }}
              />
            </div>

            <span className="truncate text-2xs capitalize text-ink-faint">
              {format(date, 'EEE', { locale: es })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
