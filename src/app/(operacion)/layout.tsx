import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';

/** Permanece montado entre rutas; loading/error solo sustituyen su contenido. */
export default function OperationalLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
