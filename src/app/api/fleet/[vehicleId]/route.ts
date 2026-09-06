import { apiError, guardApi } from '@/lib/api';
import { loadVehicleDetail } from '@/services/aggregation/fleet-aggregator';
import { asVehicleId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const denied = await guardApi('flota.ver');
  if (denied) return denied;

  const { vehicleId } = await params;

  try {
    const detail = await loadVehicleDetail(asVehicleId(vehicleId));
    if (!detail) return apiError('Vehiculo no encontrado.', 404);
    return NextResponse.json(detail);
  } catch (error) {
    return apiError(
      'No fue posible obtener el detalle del vehiculo.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
