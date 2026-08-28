import { apiError } from '@/lib/api';
import { loadClientDetail } from '@/services/aggregation/client-aggregator';
import { asClientId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  const { clientId } = await params;

  try {
    const detail = await loadClientDetail(asClientId(clientId));
    if (!detail) return apiError('Cliente no encontrado.', 404);
    return NextResponse.json(detail);
  } catch (error) {
    return apiError(
      'No fue posible obtener el detalle del cliente.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
