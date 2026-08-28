import { cn } from '@/lib/cn';

export interface ProgressBarProps {
  /** 0-1 */
  value: number;
  label?: string;
  tone?: 'brand' | 'active' | 'warning';
  size?: 'sm' | 'md';
  className?: string;
}

const TONE_BG = {
  brand: 'bg-brand-400',
  active: 'bg-status-active',
  warning: 'bg-status-warning',
} as const;

export function ProgressBar({ value, label, tone = 'brand', size = 'md', className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, value));

  return (
    <div className={className}>
      {label ? (
        <div className="mb-1 flex items-center justify-between gap-2 text-2xs text-ink-faint">
          <span className="truncate">{label}</span>
          <span className="numeric shrink-0">{Math.round(clamped * 100)} %</span>
        </div>
      ) : null}
      <div
        className={cn('overflow-hidden rounded-full bg-surface-750', size === 'sm' ? 'h-1' : 'h-1.5')}
        role="progressbar"
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', TONE_BG[tone])}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}

export interface RouteProgressProps {
  completed: number;
  total: number;
  className?: string;
  /** Texto alternativo cuando la ruta no tiene paradas. */
  emptyLabel?: string;
}

/** Avance de entregas: "2 / 5 entregas detectadas". */
export function RouteProgress({ completed, total, className, emptyLabel }: RouteProgressProps) {
  if (total === 0) {
    return <p className={cn('text-xs text-ink-faint', className)}>{emptyLabel ?? 'Sin paradas asignadas'}</p>;
  }

  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="numeric text-xs font-medium text-ink">
          {completed} / {total}
        </span>
        <span className="text-2xs text-ink-faint">entregas detectadas</span>
      </div>
      <ProgressBar value={completed / total} tone={completed === total ? 'active' : 'brand'} size="sm" />
    </div>
  );
}
