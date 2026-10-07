import { WorkOrderDetailView } from '@/components/orders/work-order-detail-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Orden de trabajo' };

export default async function WorkOrderPage({
  params,
}: {
  params: Promise<{ workOrderId: string }>;
}) {
  const { workOrderId } = await params;

  return (
    <ErrorBoundary section="el detalle de la orden de trabajo">
      <WorkOrderDetailView workOrderId={workOrderId} />
    </ErrorBoundary>
  );
}
