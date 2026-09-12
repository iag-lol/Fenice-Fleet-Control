import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

/**
 * Estado vacio. Siempre explica QUE no hay y POR QUE, y ofrece la accion que
 * lo resuelve. Nunca un "sin datos" a secas.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14',
        className,
      )}
    >
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600 ring-8 ring-brand-50/50">
          {icon}
        </span>
      ) : null}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        {description ? <p className="text-xs leading-relaxed text-ink-faint">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
