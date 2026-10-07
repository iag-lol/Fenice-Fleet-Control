import { apiError, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { buildWorkOrderPdf } from '@/lib/documents/work-order-pdf';
import { getOperationsProvider } from '@/services/registry';
import { asWorkOrderId } from '@/types/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ workOrderId: string }> }): Promise<Response> {
  const denied = await guardApi('ordenes.ver');
  if (denied) return denied;
  const { workOrderId } = await params;
  try {
    const operations = getOperationsProvider();
    const workOrder = await operations.getWorkOrderById(asWorkOrderId(workOrderId));
    if (!workOrder) return apiError('Orden de trabajo no encontrada.', 404);
    const [order, vehicles, drivers] = await Promise.all([
      operations.getOrderById(workOrder.orderId), operations.getVehicles(), operations.getDrivers(),
    ]);
    const bytes = await buildWorkOrderPdf({ workOrder, order,
      vehicle: vehicles.find((v) => v.id === workOrder.vehicleId) ?? null,
      driver: drivers.find((d) => d.id === workOrder.driverId) ?? null, simulated: operations.info.simulated });
    const filename = workOrder.number.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) || 'orden-de-trabajo';
    return new Response(Buffer.from(bytes), { headers: { ...NO_STORE_HEADERS, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}.pdf"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return apiError('No fue posible generar la OT. Intenta descargarla nuevamente.', 503);
  }
}
