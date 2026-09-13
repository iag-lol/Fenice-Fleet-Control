'use client';

import { X } from 'lucide-react';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { useIsDesktop } from '@/hooks/use-media-query';

const VIEWPORT_MARGIN = 12;

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
  /** Boton que ancla el desplegable en escritorio. */
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const isDesktop = useIsDesktop();
  const [montado, setMontado] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(
    null,
  );

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    if (!open || isDesktop) return;
    const previo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previo;
    };
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open, onClose]);

  /**
   * Posicion en escritorio/tablet, calculada en vez de anclada por CSS.
   *
   * El boton vive dentro del contenedor del mapa, que recorta su contenido
   * (`overflow-hidden`) para que el mapa nunca se desborde. Un desplegable
   * `absolute` anclado a la derecha del boton, al abrirse hacia la izquierda,
   * quedaba recortado por ese borde justo donde empieza el sidebar o el panel
   * operativo en una tablet (poco ancho disponible): parecia abrirse "detras"
   * de ellos. `fixed` con la posicion calculada aqui ignora ese recorte (los
   * elementos `fixed` no lo heredan de un ancestro sin transform/filter) y se
   * ajusta para no salirse nunca de la pantalla.
   */
  useEffect(() => {
    if (!open || !isDesktop) return;

    const reposition = (): void => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const left = Math.min(
        Math.max(rect.right - width, VIEWPORT_MARGIN),
        window.innerWidth - width - VIEWPORT_MARGIN,
      );
      const top = Math.min(rect.bottom + 8, window.innerHeight - VIEWPORT_MARGIN);
      const maxHeight = window.innerHeight - top - VIEWPORT_MARGIN;
      setPosition({ top, left, maxHeight });
    };

    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [open, isDesktop, width, anchorRef]);

  if (!open) return null;

  if (isDesktop) {
    if (!position) return null;

    return (
      <>
        <button
          type="button"
          aria-label={`Cerrar ${title.toLowerCase()}`}
          className="fixed inset-0 z-10 cursor-default"
          onClick={onClose}
        />
        <div
          className="fixed z-20 overflow-y-auto animate-slide-up rounded-lg border border-line-strong bg-surface-900 p-2 shadow-panel"
          style={{
            width,
            maxWidth: `calc(100vw - ${VIEWPORT_MARGIN * 2}px)`,
            top: position.top,
            left: position.left,
            maxHeight: position.maxHeight,
          }}
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
    document.fullscreenElement ?? document.body,
  );
}
