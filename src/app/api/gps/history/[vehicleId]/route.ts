import { apiError, guardApi, handleApi } from '@/lib/api';
import { getGpsProvider } from '@/services/registry';
import { normalizeGpsHistory } from '@/lib/gps-history';
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
  const toMs = Date.parse(to);
  const from = url.searchParams.get('desde') ?? (Number.isFinite(toMs)
    ? new Date(toMs - hours * 3_600_000).toISOString() : '');
  const fromMs = Date.parse(from);
  const limit = Number(url.searchParams.get('limite') ?? '5000');
  if (!Number.isFinite(toMs) || !Number.isFinite(fromMs) || fromMs >= toMs || toMs - fromMs > 72 * 3_600_000) {
    return apiError('Selecciona fechas validas en orden, con un rango maximo de 72 horas.', 400);
  }
  if (!Number.isInteger(limit) || limit < 2 || limit > 20_000) {
    return apiError('El limite de muestras debe estar entre 2 y 20000.', 400);
  }
  return handleApi(async () => {
    const positions = await getGpsProvider().getPositionHistory({
      vehicleId: asVehicleId(vehicleId), from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(), limit,
    });
    return normalizeGpsHistory(positions.filter((p) => p.vehicleId === vehicleId &&
      Date.parse(p.timestamp) >= fromMs && Date.parse(p.timestamp) <= toMs), limit);
  }, 'el historial GPS del vehiculo');
}
