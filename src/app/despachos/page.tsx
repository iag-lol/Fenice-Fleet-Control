import { Suspense } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';
import { DispatchBoardView } from '@/features/medium/dispatch-board/dispatch-board-view';

export const metadata = { title: 'Despachos en curso' };

export default function DespachosPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el panel de despachos">
        <Suspense fallback={<SkeletonRows rows={8} />}>
          <DispatchBoardView />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
