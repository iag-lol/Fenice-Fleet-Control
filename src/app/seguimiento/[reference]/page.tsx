import { Suspense } from 'react';

import { TrackingView } from '@/components/tracking/tracking-view';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata = {
  title: 'Seguimiento de pedido',
  description: 'Consulta el estado y la ubicacion de tu pedido de Fenice SpA.',
};

/**
 * Enlace directo de seguimiento, uno por pedido.
 *
 * Es el que se comparte con el cliente (WhatsApp, correo, boleta digital):
 * `/seguimiento/OT-2026-001582` en vez de `/seguimiento?ref=...`. Abre
 * directo en su pedido, sin que tenga que escribir ni pegar nada.
 */
export default async function SeguimientoPorReferenciaPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  return (
    <Suspense
      fallback={
        <div className="min-h-app space-y-3 bg-surface-950 p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      }
    >
      <TrackingView presetReference={decodeURIComponent(reference).toUpperCase()} />
    </Suspense>
  );
}
