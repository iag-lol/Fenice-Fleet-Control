import { NextResponse } from 'next/server';

import { apiError, handleApi } from '@/lib/api';
import { ForbiddenError, requirePermission, UnauthorizedError } from '@/lib/auth';
import {
  createGeofence,
  geofenceInputSchema,
  listGeofences,
} from '@/services/geofences/geofence-store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handleApi(async () => ({ geofences: listGeofences() }), 'las geocercas');
}

/**
 * Crea una geocerca.
 *
 * Las geocercas son un artefacto de la plataforma, no del ERP de Fenice: por
 * eso admiten escritura sin romper el contrato de solo lectura sobre la base
 * externa.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await requirePermission('configuracion.editar');
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(error.message, 401);
    if (error instanceof ForbiddenError) return apiError(error.message, 403);
    throw error;
  }

  const parsed = geofenceInputSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'La geocerca no es valida.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  return NextResponse.json(createGeofence(parsed.data), { status: 201 });
}
