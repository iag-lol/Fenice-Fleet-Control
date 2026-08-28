import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import { ForbiddenError, requirePermission, UnauthorizedError } from '@/lib/auth';
import {
  deleteGeofence,
  duplicateGeofence,
  geofenceInputSchema,
  getGeofence,
  updateGeofence,
} from '@/services/geofences/geofence-store';
import { asGeofenceId } from '@/types/core';

export const dynamic = 'force-dynamic';

async function guard(): Promise<Response | null> {
  try {
    await requirePermission('configuracion.editar');
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(error.message, 401);
    if (error instanceof ForbiddenError) return apiError(error.message, 403);
    throw error;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ geofenceId: string }> },
): Promise<Response> {
  const { geofenceId } = await params;
  const geofence = getGeofence(asGeofenceId(geofenceId));
  if (!geofence) return apiError('Geocerca no encontrada.', 404);
  return NextResponse.json(geofence);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ geofenceId: string }> },
): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;

  const { geofenceId } = await params;
  const body = await request.json().catch(() => null);

  // Duplicar es una accion, no una edicion: se expresa en el mismo endpoint
  // para no multiplicar rutas por cada operacion sobre el recurso.
  if (body && typeof body === 'object' && 'action' in body && body.action === 'duplicate') {
    const copy = duplicateGeofence(asGeofenceId(geofenceId));
    if (!copy) return apiError('Geocerca no encontrada.', 404);
    return NextResponse.json(copy, { status: 201 });
  }

  const parsed = geofenceInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Los cambios no son validos.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const updated = updateGeofence(asGeofenceId(geofenceId), parsed.data);
  if (!updated) return apiError('Geocerca no encontrada.', 404);
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ geofenceId: string }> },
): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;

  const { geofenceId } = await params;
  if (!deleteGeofence(asGeofenceId(geofenceId))) {
    return apiError('Geocerca no encontrada.', 404);
  }
  return new Response(null, { status: 204 });
}
