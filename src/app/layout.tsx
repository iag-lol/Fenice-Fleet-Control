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
  // Instalable como aplicacion en telefono y en escritorio.
  manifest: '/app.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Fenice',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icon-192.png', sizes: '192x192' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#0b5c75',
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
