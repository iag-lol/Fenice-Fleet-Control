import { Suspense } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { TerritoryView } from '@/components/territory/territory-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Inteligencia territorial' };

export default function TerritorioPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el analisis territorial">
        <Suspense fallback={<SkeletonRows rows={8} />}>
          <TerritoryView />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
