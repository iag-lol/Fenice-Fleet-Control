'use client';

import type { ReactNode } from 'react';

import { Header } from '@/components/shell/header';
import { MobileMenuSheet, MobileTabBar } from '@/components/shell/mobile-nav';
import { PwaProvider } from '@/components/shell/pwa-provider';
import { AlertToasts } from '@/features/medium/notifications/alert-toasts';
import { Sidebar } from '@/components/shell/sidebar';
import { useAppHeight } from '@/hooks/use-app-height';
import { cn } from '@/lib/cn';

export interface AppShellProps {
  children: ReactNode;
  /**
   * Paginas que gestionan su propio desplazamiento (el mapa operacional).
   * Evita el doble scroll y permite que el mapa ocupe toda la altura.
   */
  fullBleed?: boolean;
}

export function AppShell({ children, fullBleed }: AppShellProps) {
  useAppHeight();

  return (
    <div className="flex h-app overflow-hidden bg-surface-950 bg-[radial-gradient(circle_at_top_right,rgba(13,144,174,0.055),transparent_32rem)]">
      <Sidebar />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <Header />

        <main
          className={cn(
            'app-shell-main min-w-0 flex-1',
            fullBleed
              ? 'relative overflow-hidden'
              : 'overflow-y-auto px-3 pb-20 pt-3 sm:px-4 sm:pb-5 lg:px-5 lg:pt-4',
          )}
        >
          {fullBleed ? children : <div className="mx-auto w-full max-w-[1600px]">{children}</div>}
        </main>

        {/* Se ancla al area de contenido, no al viewport completo: asi nunca
            invade el sidebar cuando aparece en escritorio o tablet. */}
        <PwaProvider />
      </div>

      <MobileTabBar />
      <MobileMenuSheet />

      {/* Avisos: flotantes dentro de la aplicacion y, con permiso, del
          sistema operativo. Se montan aqui para que lleguen en cualquier
          pantalla, no solo en el centro de alertas. */}
      <AlertToasts />
    </div>
  );
}
