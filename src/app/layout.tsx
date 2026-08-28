import type { Metadata, Viewport } from 'next';

import { AppProviders } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Fenice Fleet Control',
    template: '%s · Fenice Fleet Control',
  },
  description:
    'Plataforma de control GPS, gestion logistica e inteligencia territorial de Fenice SpA.',
  applicationName: 'Fenice Fleet Control',
  // La plataforma es de uso interno: no debe indexarse.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  width: 'device-width',
  initialScale: 1,
  // `viewportFit: cover` habilita las variables de area segura en iOS.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-CL">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
