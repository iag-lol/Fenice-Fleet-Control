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
