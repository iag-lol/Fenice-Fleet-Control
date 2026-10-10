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
  /**
   * Deja el mapa visible detras: no oscurece la pantalla completa.
   *
   * En escritorio/tablet (>= `sm`) implica ademas que el fondo NO es modal:
   * el velo no se pinta y no intercepta el puntero, asi que el mapa sigue
   * respondiendo al arrastre, el zoom y los clics mientras el panel esta
   * abierto. Un velo de pantalla completa (aunque tenue) volvia el mapa
   * inutilizable con cualquier ficha abierta: se podia VER pero no tocar.
   * En movil se mantiene como hoja modal de toda la pantalla, que es el
   * patron nativo.
   */
  transparentOverlay?: boolean;
  /** Tarjeta de herramientas anclada dentro de su contenedor en escritorio. */
  floating?: boolean;
  footer?: ReactNode;
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
  floating = false,
  footer,
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
    <div
      className={cn(
        'app-sheet-root fixed inset-0 z-50 flex',
        // Las fichas del mapa viven bajo el header de escritorio. Asi la
        // busqueda, el reloj y el estado GPS siguen visibles y utilizables.
        transparentOverlay && !floating && 'sm:top-14',
        floating && 'map-filter-sheet sm:absolute sm:inset-0',
        // El contenedor tambien cubre toda la pantalla. Desactivar solo el
        // velo no basta: el propio contenedor seguia siendo el objetivo del
        // puntero y bloqueaba el mapa. En escritorio dejamos pasar los
        // eventos y los reactivamos exclusivamente dentro del panel.
        transparentOverlay && 'sm:pointer-events-none',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
    >
      <button
        type="button"
        aria-label="Cerrar panel"
        onClick={onClose}
        tabIndex={transparentOverlay ? -1 : 0}
        className={cn(
          'app-sheet-overlay absolute inset-0 animate-fade-in',
          transparentOverlay
            ? 'bg-[rgba(15,28,46,0.18)] sm:pointer-events-none sm:bg-transparent'
            : 'bg-overlay backdrop-blur-[2px]',
        )}
      />

      <div
        className={cn(
          'app-sheet-panel pointer-events-auto relative z-10 flex w-full flex-col overflow-hidden border-line bg-surface-900 shadow-panel',
          // Movil: hoja inferior con esquinas superiores redondeadas.
          'mt-auto max-h-[88vh] animate-sheet-up rounded-t-xl border-t safe-bottom',
          // Escritorio: panel lateral a altura completa.
          'sm:mt-0 sm:animate-fade-in sm:rounded-none sm:border-t-0',
          !floating && 'sm:max-h-none',
          side === 'right'
            ? 'sm:ml-auto sm:h-full sm:w-[360px] sm:border-l lg:w-[clamp(320px,24vw,420px)]'
            : 'sm:mr-auto sm:h-full sm:w-[360px] sm:border-r lg:w-[clamp(320px,24vw,420px)]',
          floating && 'sm:ml-3 sm:mr-auto sm:mt-[128px] sm:mb-3 sm:h-auto sm:max-h-[calc(100%_-_140px)] sm:w-[420px] sm:self-start sm:rounded-2xl sm:border lg:w-[440px]',
          className,
        )}
      >
        {/* Asa de arrastre: senal visual del gesto en movil. */}
        <div className="app-sheet-handle flex justify-center pt-2 sm:hidden">
          <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
        </div>

        {title ? (
          <div className={cn('flex items-start justify-between gap-3 border-b border-line px-4 py-3', floating && 'sm:py-2.5')}>
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer ? <div className="shrink-0 border-t border-line bg-surface-900">{footer}</div> : null}
      </div>
    </div>
  );
}
