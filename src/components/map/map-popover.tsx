'use client';

import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useIsDesktop } from '@/hooks/use-media-query';

/**
 * Contenedor de los desplegables del mapa.
 *
 * En escritorio es un desplegable anclado al boton. En un telefono NO puede
 * serlo: los controles del mapa viven pegados al borde izquierdo y un panel
 * anclado a la derecha del boton se sale de la pantalla; se veia cortado por
 * la mitad, con las etiquetas mutiladas.
 *
 * En movil pasa a ser una hoja inferior a ancho completo, que ademas queda
 * al alcance del pulgar en vez de en la esquina superior.
 */
export function MapPopover({
  open,
  onClose,
  title,
  children,
  /** Ancho del desplegable en escritorio. */
  width = 280,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  const isDesktop = useIsDesktop();
  const [montado, setMontado] = useState(false);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!open || isDesktop) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, [open, isDesktop]);

  if (!open) return null;

  if (isDesktop) {
    return (
      <>
        <button
          type="button"
          aria-label={`Cerrar ${title.toLowerCase()}`}
          className="fixed inset-0 z-10 cursor-default"
          onClick={onClose}
        />
        <div
          className="absolute right-0 top-full z-20 mt-2 max-w-[calc(100vw-1.5rem)] animate-slide-up rounded-lg border border-line-strong bg-surface-900 p-2 shadow-panel"
          style={{ width }}
        >
          {children}
        </div>
      </>
    );
  }

  /**
   * La hoja se lleva al final del documento con un portal.
   *
   * El mapa y su contenedor crean su propio contexto de apilamiento, asi que
   * un `z-index` alto dentro de el no supera a elementos de fuera: el aviso
   * de instalacion y la barra inferior se dibujaban ENCIMA de la hoja. Fuera
   * del arbol del mapa, el orden vuelve a ser el esperado.
   */
  if (!montado) return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] md:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label={`Cerrar ${title.toLowerCase()}`}
        onClick={onClose}
        className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]"
      />

      <div className="absolute inset-x-0 bottom-0 flex max-h-[82vh] animate-slide-up flex-col rounded-t-2xl border-t border-line bg-surface-900 shadow-panel">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="text-sm font-semibold text-ink">{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-ink-faint hover:bg-surface-800 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
