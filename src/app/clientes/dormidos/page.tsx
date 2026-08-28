import { DormantClientsView } from '@/components/clients/dormant-clients-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Clientes dormidos' };

export default function ClientesDormidosPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el listado de clientes dormidos">
        <DormantClientsView />
      </ErrorBoundary>
    </AppShell>
  );
}
