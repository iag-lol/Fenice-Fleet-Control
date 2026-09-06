import { apiError, guardApi, handleApi } from '@/lib/api';
import { getGpsProvider } from '@/services/registry';
import { asVehicleId } from '@/types/core';

export const dynamic = 'force-dynamic';

/** Historial de posiciones de un vehiculo dentro de una ventana temporal. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const denied = await guardApi('flota.ver');
  if (denied) return denied;

  const { vehicleId } = await params;
  const url = new URL(request.url);

  const hours = Number(url.searchParams.get('horas') ?? '8');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 72) {
    return apiError('El parametro "horas" debe estar entre 1 y 72.', 400);
  }

  const to = url.searchParams.get('hasta') ?? new Date().toISOString();
  const from =
    url.searchParams.get('desde') ??
    new Date(new Date(to).getTime() - hours * 3_600_000).toISOString();

  return handleApi(
    () =>
      getGpsProvider().getPositionHistory({
        vehicleId: asVehicleId(vehicleId),
        from,
        to,
        limit: Number(url.searchParams.get('limite') ?? '800'),
      }),
    'el historial GPS del vehiculo',
  );
}
