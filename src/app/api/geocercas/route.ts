import { NextResponse } from 'next/server';

import { apiError, assertSameOrigin, getClientIp, guardApi, handleApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import {
  createGeofence,
  geofenceInputSchema,
  listGeofences,
} from '@/services/geofences/geofence-store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi('geocercas.ver');
  if (denied) return denied;

  return handleApi(async () => ({ geofences: await listGeofences() }), 'las geocercas');
}

/**
 * Crea una geocerca.
 *
 * Las geocercas son un artefacto de la plataforma, no del ERP de Fenice: por
 * eso admiten escritura sin romper el contrato de solo lectura sobre la base
 * externa.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('geocercas.editar');
  if (denied) return denied;

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

  let created;
  try {
    created = await createGeofence(parsed.data);
  } catch (error) {
    // El detalle (ej. una politica de Row Level Security bloqueando el
    // insert) viaja en el mensaje de error: quien crea geocercas ya tiene el
    // permiso `geocercas.editar`, y ese detalle tecnico es lo que permite
    // diagnosticar una configuracion de Supabase incorrecta sin mirar logs
    // del servidor.
    return apiError(error instanceof Error ? error.message : 'No fue posible guardar la geocerca.', 503);
  }

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'geocerca.crear',
    entity: 'geocercas',
    entityId: created.id,
    detail: { nombre: created.name, tipo: created.kind },
    ip: getClientIp(request),
  });

  return NextResponse.json(created, { status: 201 });
}
