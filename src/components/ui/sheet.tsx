'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** Lado en escritorio. En movil siempre se comporta como bottom sheet. */
  side?: 'right' | 'left';
  className?: string;
  /** Deja el mapa visible detras: no oscurece la pantalla completa. */
  transparentOverlay?: boolean;
}

/**
 * Panel deslizable.
 *
 * Escritorio: panel lateral. Movil: bottom sheet, que es el patron nativo y
 * el exigido para filtros y fichas de camion y cliente.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  side = 'right',
  className,
  transparentOverlay,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);
    // Bloquear el scroll del fondo mientras el panel esta abierto.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <button
        type="button"
        aria-label="Cerrar panel"
        onClick={onClose}
        className={cn(
          'absolute inset-0 animate-fade-in',
          transparentOverlay ? 'bg-[rgba(15,28,46,0.18)]' : 'bg-overlay backdrop-blur-[2px]',
        )}
      />

      <div
        className={cn(
          'relative z-10 flex w-full flex-col overflow-hidden border-line bg-surface-900 shadow-panel',
          // Movil: hoja inferior con esquinas superiores redondeadas.
          'mt-auto max-h-[88vh] animate-sheet-up rounded-t-xl border-t safe-bottom',
          // Escritorio: panel lateral a altura completa.
          'sm:mt-0 sm:max-h-none sm:animate-fade-in sm:rounded-none sm:border-t-0',
          side === 'right'
            ? 'sm:ml-auto sm:h-full sm:w-[420px] sm:border-l lg:w-[460px]'
            : 'sm:mr-auto sm:h-full sm:w-[420px] sm:border-r lg:w-[460px]',
          className,
        )}
      >
        {/* Asa de arrastre: senal visual del gesto en movil. */}
        <div className="flex justify-center pt-2 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        </div>

        {title ? (
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-ink">{title}</h2>
              {description ? <p className="mt-0.5 text-xs text-ink-faint">{description}</p> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="tap -mr-2 flex items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-800 hover:text-ink sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
