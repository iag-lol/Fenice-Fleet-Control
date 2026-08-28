import { RoutesView } from '@/components/routes/routes-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Rutas' };

export default function RutasPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el listado de rutas">
        <RoutesView />
      </ErrorBoundary>
    </AppShell>
  );
}
