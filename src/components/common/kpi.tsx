import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { KpiValue } from '@/types/views';

export interface KpiCardProps {
  label: string;
  kpi: KpiValue;
  icon?: ReactNode;
  /** Acento del valor. Refleja urgencia operacional, no decoracion. */
  tone?: 'neutral' | 'brand' | 'active' | 'warning' | 'danger';
  href?: string;
  suffix?: string;
  hint?: string;
}

const TONE_TEXT = {
  neutral: 'text-ink',
  brand: 'text-brand-700',
  active: 'text-status-active',
  warning: 'text-status-warning',
  danger: 'text-status-dormant',
} as const;

/**
 * Tarjeta de indicador.
 *
 * La tendencia se colorea segun si la variacion es DESEABLE, no segun si es
 * positiva: mas vehiculos offline es un aumento, y es malo.
 */
export function KpiCard({ label, kpi, icon, tone = 'neutral', href, suffix, hint }: KpiCardProps) {
  const trend = kpi.trend;
  const change = trend?.changeRatio ?? null;

  const good =
    change === null || trend === null || trend.goodDirection === 'neutral'
      ? null
      : trend.goodDirection === 'up'
        ? change > 0
        : change < 0;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-medium uppercase tracking-wider text-ink-faint">{label}</p>
        {icon ? <span className="shrink-0 text-ink-faint">{icon}</span> : null}
      </div>

      <div className="mt-2 flex items-end gap-2">
        <span className={cn('numeric text-2xl font-semibold leading-none', TONE_TEXT[tone])}>
          {formatNumber(kpi.value)}
        </span>
        {suffix ? <span className="pb-0.5 text-xs text-ink-faint">{suffix}</span> : null}
      </div>

      {change !== null && Math.abs(change) >= 0.005 ? (
        <div
          className={cn(
            'mt-2 flex items-center gap-1 text-2xs',
            good === null ? 'text-ink-faint' : good ? 'text-status-active' : 'text-status-dormant',
          )}
        >
          {change > 0 ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : change < 0 ? (
            <ArrowDownRight className="h-3 w-3" />
          ) : (
            <ArrowRight className="h-3 w-3" />
          )}
          <span className="numeric">{formatPercent(Math.abs(change), 0)}</span>
          <span className="text-ink-faint">vs ayer</span>
        </div>
      ) : hint ? (
        <p className="mt-2 text-2xs text-ink-faint">{hint}</p>
      ) : (
        <div className="mt-2 h-[15px]" aria-hidden />
      )}
    </>
  );

  const className =
    'rounded-lg border border-line bg-surface-850 shadow-card p-3.5 transition-colors sm:p-4';

  if (href) {
    return (
      <Link href={href} className={cn(className, 'block hover:border-brand-300 hover:shadow-float')}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4', className)}>
      {children}
    </div>
  );
}

/** Cifra compacta para cabeceras y fichas de detalle. */
export function Stat({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof TONE_TEXT;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="truncate text-2xs uppercase tracking-wider text-ink-faint">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-medium', TONE_TEXT[tone ?? 'neutral'])}>{value}</p>
    </div>
  );
}
