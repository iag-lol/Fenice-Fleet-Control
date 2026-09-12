import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface StatChipItem {
  key: string;
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'brand' | 'active' | 'warning' | 'danger';
  onClick?: () => void;
  active?: boolean;
}

const TONE = {
  neutral: { text: 'text-ink', chip: 'bg-surface-750 text-ink-faint' },
  brand: { text: 'text-brand-700', chip: 'bg-brand-500/10 text-brand-700' },
  active: { text: 'text-status-active', chip: 'bg-status-active/10 text-status-active' },
  warning: { text: 'text-status-warning', chip: 'bg-status-warning/10 text-status-warning' },
  danger: { text: 'text-status-dormant', chip: 'bg-status-dormant/10 text-status-dormant' },
} as const;

/**
 * Fila de metricas rapidas para encabezados de listado.
 *
 * Reemplaza la descripcion de texto plano ("124 clientes, 30 activos...")
 * por cifras que se leen de un vistazo y que, cuando llevan `onClick`,
 * funcionan ademas como filtro rapido (mismo patron que las tarjetas de
 * severidad del centro de alertas).
 */
export function StatChipRow({ items, className }: { items: StatChipItem[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {items.map((item) => {
        const tone = TONE[item.tone ?? 'neutral'];
        const Comp = item.onClick ? 'button' : 'div';

        return (
          <Comp
            key={item.key}
            type={item.onClick ? 'button' : undefined}
            onClick={item.onClick}
            className={cn(
              'flex items-center gap-2 rounded-full border py-1 pl-1.5 pr-3 text-left transition-colors',
              item.active
                ? 'border-brand-500 bg-brand-500/10'
                : 'border-line bg-surface-900 hover:border-line-strong',
              item.onClick && 'cursor-pointer',
            )}
          >
            {item.icon ? (
              <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', tone.chip)}>
                {item.icon}
              </span>
            ) : null}
            <span className="flex items-baseline gap-1.5">
              <span className={cn('numeric text-sm font-semibold leading-none', tone.text)}>{item.value}</span>
              <span className="text-2xs text-ink-faint">{item.label}</span>
            </span>
          </Comp>
        );
      })}
    </div>
  );
}
