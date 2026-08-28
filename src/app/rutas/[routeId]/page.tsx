import { RouteDetailView } from '@/components/routes/route-detail-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Detalle de ruta' };

export default async function RouteDetailPage({
  params,
}: {
  params: Promise<{ routeId: string }>;
}) {
  const { routeId } = await params;

  return (
    <AppShell>
      <ErrorBoundary section="el detalle de la ruta">
        <RouteDetailView routeId={routeId} />
      </ErrorBoundary>
    </AppShell>
  );
}
