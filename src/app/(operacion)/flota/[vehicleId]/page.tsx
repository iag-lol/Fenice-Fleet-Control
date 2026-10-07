import { VehicleDetailView } from '@/components/fleet/vehicle-detail-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Detalle de vehiculo' };

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>;
}) {
  const { vehicleId } = await params;

  return (
    <ErrorBoundary section="el detalle del vehiculo">
      <VehicleDetailView vehicleId={vehicleId} />
    </ErrorBoundary>
  );
}
