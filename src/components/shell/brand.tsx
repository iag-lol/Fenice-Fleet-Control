import { cn } from '@/lib/cn';

/**
 * Identidad de Fenice Fleet Control. Marca sobria y tecnica: el producto se
 * presenta a un cliente empresarial, no a un consumidor.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-brand-500 to-brand-800 shadow-sm',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" width={18} height={18}>
        <path
          d="M12 2.6 4.4 6.4v6.1c0 4.4 3.2 8.1 7.6 9 4.4-.9 7.6-4.6 7.6-9V6.4L12 2.6Z"
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path d="M8.6 12.2h6.8M12 8.8v6.8" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function BrandLockup({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {!compact ? (
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-semibold tracking-tight text-ink">
            Fenice Fleet Control
          </p>
          <p className="truncate text-2xs text-ink-faint">Control GPS y logistica</p>
        </div>
      ) : null}
    </div>
  );
}
