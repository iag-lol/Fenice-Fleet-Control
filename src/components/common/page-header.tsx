import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-4 flex flex-col gap-3 sm:mb-5', className)}>
      {breadcrumb ? (
        <div className="-my-2 text-xs text-ink-faint [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center sm:my-0 sm:[&_a]:min-h-0">
          {breadcrumb}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
            {title}
          </h1>
          {description ? (
            <div className="mt-1 text-[13px] leading-relaxed text-ink-muted">{description}</div>
          ) : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
