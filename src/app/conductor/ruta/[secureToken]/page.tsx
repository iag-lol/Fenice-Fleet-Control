import type { Metadata, Viewport } from 'next';

import { DriverRouteView } from '@/features/medium/driver-portal/driver-route-view';
import { DriverPwa } from '@/features/medium/driver-portal/driver-pwa';

/**
 * Portal del conductor.
 *
 * El token viaja en la ruta y no en un parametro de consulta porque los
 * parametros se filtran con mas facilidad (referer, historial compartido,
 * registros de analitica). Aun asi se bloquea la indexacion: un enlace que
 * es en si mismo la credencial jamas debe terminar en un buscador.
 */
export const metadata: Metadata = {
  title: 'Mi ruta',
  description: 'Paradas, carga y entregas de la jornada.',
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: '#0b5c75',
  width: 'device-width',
  initialScale: 1,
  // El conductor opera con una mano: se evita el zoom accidental al tocar
  // dos veces, sin impedir el zoom deliberado con dos dedos.
  maximumScale: 5,
  viewportFit: 'cover',
};

export default async function DriverRoutePage({
  params,
}: {
  params: Promise<{ secureToken: string }>;
}) {
  const { secureToken } = await params;

  return (
    <>
      <DriverPwa />
      <DriverRouteView token={secureToken} />
    </>
  );
}
