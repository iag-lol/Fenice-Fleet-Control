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
 * Rango de tablet: 768-1023px por ancho, O cualquier ancho >=768px con
 * puntero "coarse" (tactil).
 *
 * Un iPad en horizontal supera los 1023px logicos (1024 a 1366px segun el
 * modelo), pero sigue siendo una pantalla tactil pequeña: sin el segundo
 * termino, se trataba como escritorio y el sidebar y el panel operativo se
 * abrian expandidos a la vez, sin dejarle espacio real al mapa.
 */
export const TABLET_RANGE_QUERY =
  '(min-width: 768px) and (max-width: 1023px), (pointer: coarse) and (min-width: 768px)';

export function useIsTabletRange(): boolean {
  return useMediaQuery(TABLET_RANGE_QUERY);
}
