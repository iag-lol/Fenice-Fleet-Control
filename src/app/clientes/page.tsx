import { Suspense } from 'react';

import { ClientsView } from '@/components/clients/clients-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonRows } from '@/components/ui/skeleton';

export const metadata = { title: 'Clientes' };

export default function ClientesPage() {
  return (
    <AppShell>
      <ErrorBoundary section="la cartera de clientes">
        <Suspense fallback={<SkeletonRows rows={10} />}>
          <ClientsView />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}
