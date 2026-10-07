import { DormantClientsView } from '@/components/clients/dormant-clients-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Clientes dormidos' };

export default function ClientesDormidosPage() {
  return (
    <ErrorBoundary section="el listado de clientes dormidos">
      <DormantClientsView />
    </ErrorBoundary>
  );
}
