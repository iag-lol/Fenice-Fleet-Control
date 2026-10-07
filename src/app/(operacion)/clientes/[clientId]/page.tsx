import { ClientDetailView } from '@/components/clients/client-detail-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Detalle de cliente' };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  return (
    <ErrorBoundary section="el detalle del cliente">
      <ClientDetailView clientId={clientId} />
    </ErrorBoundary>
  );
}
