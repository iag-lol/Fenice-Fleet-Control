'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/**
 * Proveedores globales del cliente.
 *
 * El QueryClient se crea dentro de estado para que cada sesion de navegador
 * tenga su propia cache y no se comparta entre peticiones en el servidor.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Los datos operacionales envejecen rapido, pero no tanto como
            // para refetchear en cada montaje de componente.
            staleTime: 20_000,
            gcTime: 5 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
