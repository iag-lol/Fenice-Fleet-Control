'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * El servidor conserva un snapshot estable para hidratar sin diferencias.
 * La navegación de cliente lee matchMedia inmediatamente, sin un render
 * provisional de escritorio en cada página de tablet.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

const serverSnapshot = () => false;

/** Punto de corte `md` de Tailwind. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}

/**
 * Tablet en orientacion vertical.
 *
 * En este formato el alto disponible no compensa perder ancho con barras y
 * fichas laterales, por lo que la aplicacion adopta la navegacion movil.
 */
export const PORTRAIT_TABLET_QUERY =
  '(min-width: 768px) and (max-width: 1279px) and (orientation: portrait)';

export function useIsPortraitTablet(): boolean {
  return useMediaQuery(PORTRAIT_TABLET_QUERY);
}

/**
 * Rango de tablet/portatil compacto: 768-1279px por ancho, O cualquier ancho >=768px con
 * puntero "coarse" (tactil).
 *
 * El limite incluye 1024px y otros anchos habituales de tablet incluso cuando
 * las herramientas del navegador informan un puntero fino. Los iPad grandes
 * en horizontal quedan cubiertos ademas por el segundo termino tactil.
 */
export const TABLET_RANGE_QUERY =
  '(min-width: 768px) and (max-width: 1279px), (pointer: coarse) and (min-width: 768px)';

export function useIsTabletRange(): boolean {
  return useMediaQuery(TABLET_RANGE_QUERY);
}
