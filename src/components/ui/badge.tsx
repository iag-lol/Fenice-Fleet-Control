import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-750 text-ink-muted',
        brand: 'bg-brand-500/15 text-brand-700',
        active: 'bg-status-active/15 text-status-active',
        warning: 'bg-status-warning/15 text-status-warning',
        danger: 'bg-status-dormant/15 text-status-dormant',
        offline: 'bg-slate-500/15 text-slate-400',
        moving: 'bg-cyan-400/15 text-cyan-300',
        purple: 'bg-purple-500/15 text-purple-300',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-2xs',
        md: 'px-2 py-1 text-xs',
      },
      outlined: { true: 'ring-1 ring-inset ring-current/25', false: '' },
    },
    defaultVariants: { tone: 'neutral', size: 'sm', outlined: false },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
  icon?: ReactNode;
}

export function Badge({ className, tone, size, outlined, dot, icon, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size, outlined }), className)} {...props}>
      {dot ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden /> : icon}
      {children}
    </span>
  );
}
