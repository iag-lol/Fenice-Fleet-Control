import { Suspense } from 'react';

import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';
import { DispatchBoardView } from '@/features/medium/dispatch-board/dispatch-board-view';

export const metadata = { title: 'Despachos en curso' };

export default function DespachosPage() {
  return (
    <ErrorBoundary section="el panel de despachos">
      <Suspense fallback={<SkeletonRows rows={8} />}>
        <DispatchBoardView />
      </Suspense>
    </ErrorBoundary>
  );
}
