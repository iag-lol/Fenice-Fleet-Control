'use client';

import { useEffect } from 'react';

/**
 * Fija `--app-vh` a la altura real del viewport.
 *
 * En movil `100vh` incluye la barra de URL que aparece y desaparece, lo que
 * hace saltar el mapa a pantalla completa. `visualViewport` da la altura
 * efectiva y evita ese salto.
 */
export function useAppHeight(): void {
  useEffect(() => {
    const apply = (): void => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty('--app-vh', `${height}px`);
    };

    apply();
    window.addEventListener('resize', apply);
    window.visualViewport?.addEventListener('resize', apply);

    return () => {
      window.removeEventListener('resize', apply);
      window.visualViewport?.removeEventListener('resize', apply);
    };
  }, []);
}
