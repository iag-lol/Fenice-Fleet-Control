import { NextResponse } from 'next/server';

import { apiError, assertSameOrigin, getClientIp, guardApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import {
  deleteGeofence,
  duplicateGeofence,
  geofenceInputSchema,
  getGeofence,
  updateGeofence,
} from '@/services/geofences/geofence-store';
import { asGeofenceId } from '@/types/core';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ geofenceId: string }> },
): Promise<Response> {
  const denied = await guardApi('geocercas.ver');
  if (denied) return denied;

  const { geofenceId } = await params;
  const geofence = await getGeofence(asGeofenceId(geofenceId));
  if (!geofence) return apiError('Geocerca no encontrada.', 404);
  return NextResponse.json(geofence);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ geofenceId: string }> },
): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('geocercas.editar');
  if (denied) return denied;

  const { geofenceId } = await params;
  const body = await request.json().catch(() => null);
  const context = await getAuthContext();
  const ip = getClientIp(request);

  // Duplicar es una accion, no una edicion: se expresa en el mismo endpoint
  // para no multiplicar rutas por cada operacion sobre el recurso.
  if (body && typeof body === 'object' && 'action' in body && body.action === 'duplicate') {
    let copy;
    try {
      copy = await duplicateGeofence(asGeofenceId(geofenceId));
    } catch (error) {
      return apiError(error instanceof Error ? error.message : 'No fue posible duplicar la geocerca.', 503);
    }
    if (!copy) return apiError('Geocerca no encontrada.', 404);

    void logAction({
      userId: context.userId,
      action: 'geocerca.duplicar',
      entity: 'geocercas',
      entityId: copy.id,
      detail: { origen: geofenceId },
      ip,
    });
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

  const updated = await updateGeofence(asGeofenceId(geofenceId), parsed.data);
  if (!updated) return apiError('Geocerca no encontrada.', 404);

  void logAction({
    userId: context.userId,
    action: 'geocerca.editar',
    entity: 'geocercas',
    entityId: updated.id,
    detail: parsed.data,
    ip,
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ geofenceId: string }> },
): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('geocercas.editar');
  if (denied) return denied;

  const { geofenceId } = await params;
  if (!(await deleteGeofence(asGeofenceId(geofenceId)))) {
    return apiError('Geocerca no encontrada.', 404);
  }

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'geocerca.eliminar',
    entity: 'geocercas',
    entityId: geofenceId,
    ip: getClientIp(request),
  });
  return new Response(null, { status: 204 });
}
