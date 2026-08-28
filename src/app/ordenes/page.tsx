import { Suspense } from 'react';

import { WorkOrdersView } from '@/components/orders/work-orders-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Ordenes de trabajo' };

export default function OrdenesPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el listado de ordenes de trabajo">
        <Suspense fallback={<SkeletonRows rows={10} />}>
          <WorkOrdersView />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
