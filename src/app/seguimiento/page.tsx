import { Suspense } from 'react';

import { TrackingView } from '@/components/tracking/tracking-view';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata = {
  title: 'Seguimiento de pedido',
  description: 'Consulta el estado y la ubicacion de tu pedido de Fenice SpA.',
};

export default function SeguimientoPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-app space-y-3 bg-surface-950 p-4">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      }
    >
      <TrackingView />
    </Suspense>
  );
}
