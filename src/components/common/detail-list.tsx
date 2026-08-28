import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface DetailItem {
  label: string;
  value: ReactNode;
  /** Ocupa el ancho completo: util para direcciones y observaciones. */
  full?: boolean;
}

export function DetailList({
  items,
  columns = 2,
  className,
}: {
  items: DetailItem[];
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  const gridClass =
    columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2';

  return (
    <dl className={cn('grid gap-x-4 gap-y-3', gridClass, className)}>
      {items.map((item) => (
        <div key={item.label} className={cn('min-w-0', item.full && 'col-span-full')}>
          <dt className="truncate text-2xs uppercase tracking-wider text-ink-faint">{item.label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
