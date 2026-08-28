import { Suspense } from 'react';

import { FleetView } from '@/components/fleet/fleet-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Flota' };

export default function FlotaPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el listado de flota">
        <Suspense fallback={<SkeletonRows rows={8} />}>
          <FleetView />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
