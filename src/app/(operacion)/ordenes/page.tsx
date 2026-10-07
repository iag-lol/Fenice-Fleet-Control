import { Suspense } from 'react';

import { WorkOrdersView } from '@/components/orders/work-orders-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Ordenes de trabajo' };

export default function OrdenesPage() {
  return (
    <ErrorBoundary section="el listado de ordenes de trabajo">
      <Suspense fallback={<SkeletonRows rows={10} />}>
        <WorkOrdersView />
      </Suspense>
    </ErrorBoundary>
  );
}
