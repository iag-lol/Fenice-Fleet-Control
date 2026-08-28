import { WorkOrderDetailView } from '@/components/orders/work-order-detail-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Orden de trabajo' };

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ workOrderId: string }>;
}) {
  const { workOrderId } = await params;

  return (
    <AppShell>
      <ErrorBoundary section="el detalle de la orden de trabajo">
        <WorkOrderDetailView workOrderId={workOrderId} />
      </ErrorBoundary>
    </AppShell>
  );
}
