'use client';

import { useEffect, useState } from 'react';

/**
 * Consulta de medios reactiva.
 *
 * Devuelve `false` en el primer render del servidor para no provocar un
 * desajuste de hidratacion; el valor real se aplica tras el montaje.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Punto de corte `md` de Tailwind. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
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
