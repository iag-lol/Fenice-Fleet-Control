import { NextResponse } from 'next/server';

import { apiError, assertSameOrigin, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { canUseFeature } from '@/product/feature-access';
import { getOperationsProvider } from '@/services/registry';
import { issueRouteToken, revokeRouteToken } from '@/services/drivers/route-token';
import type { RouteId } from '@/types/core';

export const dynamic = 'force-dynamic';

/**
 * Emite el enlace con el que el conductor abre SU ruta.
 *
 * El enlace se genera bajo demanda y no se guarda: quien lo pide es quien lo
 * envia al conductor. Emitir uno nuevo no invalida el anterior (el conductor
 * puede tener el suyo abierto); para eso existe el DELETE.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ routeId: string }> },
): Promise<Response> {
  if (!canUseFeature('driver-portal')) {
    return apiError('El portal del conductor no esta incluido en este plan.', 404);
  }

  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('rutas.editar');
  if (denied) return denied;

  const { routeId } = await params;
  const route = await getOperationsProvider().getRouteById(routeId as RouteId);
  if (!route) return apiError('La ruta no existe.', 404);

  const body = (await request.json().catch(() => null)) as { ttlHours?: number } | null;
  const ttlHours =
    typeof body?.ttlHours === 'number' && body.ttlHours > 0 && body.ttlHours <= 168
      ? Math.floor(body.ttlHours)
      : undefined;

  const issued = await issueRouteToken(route.id, ttlHours ? { ttlHours } : undefined);

  const response = NextResponse.json(
    {
      token: issued.token,
      path: issued.path,
      expiresAt: issued.expiresAt,
      routeCode: route.code,
      routeName: route.name,
    },
    { status: 201 },
  );
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}

/** Anula un enlace ya entregado: telefono perdido o cambio de conductor. */
export async function DELETE(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('rutas.editar');
  if (denied) return denied;

  const token = new URL(request.url).searchParams.get('token')?.trim() ?? '';
  if (token.length < 20) return apiError('Indica el enlace que quieres anular.', 400);

  await revokeRouteToken(token);
  return NextResponse.json({ revoked: true });
}
