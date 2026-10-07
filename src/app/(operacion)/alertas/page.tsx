import { Suspense } from 'react';

import { AlertsView } from '@/components/alerts/alerts-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Centro de alertas' };

export default function AlertasPage() {
  return (
    <ErrorBoundary section="el centro de alertas">
      <Suspense fallback={<SkeletonRows rows={8} />}>
        <AlertsView />
      </Suspense>
    </ErrorBoundary>
  );
}
