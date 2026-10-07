import { Suspense } from 'react';

import { TerritoryView } from '@/components/territory/territory-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Inteligencia territorial' };

export default function TerritorioPage() {
  return (
    <ErrorBoundary section="el analisis territorial">
      <Suspense fallback={<SkeletonRows rows={8} />}>
        <TerritoryView />
      </Suspense>
    </ErrorBoundary>
  );
}
