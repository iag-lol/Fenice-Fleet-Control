import { RoutesView } from '@/components/routes/routes-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Rutas' };

export default function RutasPage() {
  return (
    <ErrorBoundary section="el listado de rutas">
      <RoutesView />
    </ErrorBoundary>
  );
}
