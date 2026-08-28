import { z } from 'zod';

import { apiError } from '@/lib/api';
import { ForbiddenError, requirePermission, UnauthorizedError } from '@/lib/auth';
import { getOperationsProvider } from '@/services/registry';
import { asAlertId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ state: z.enum(['nueva', 'revisada', 'resuelta']) });

/**
 * Cambia el estado de una alerta.
 *
 * El ciclo de vida de las alertas es un artefacto de ESTA plataforma, no de la
 * base de Fenice: por eso admite escritura sin violar el contrato de solo
 * lectura sobre la fuente externa.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ alertId: string }> },
): Promise<Response> {
  const { alertId } = await params;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Estado invalido. Valores permitidos: nueva, revisada, resuelta.', 400);
  }

  try {
    // Inerte mientras AUTH_ENABLED=false; al activarla, este es el punto de
    // control, sin tocar la interfaz ni los proveedores.
    await requirePermission('alertas.resolver');

    const alert = await getOperationsProvider().updateAlertState(
      asAlertId(alertId),
      parsed.data.state,
    );
    if (!alert) return apiError('Alerta no encontrada.', 404);
    return NextResponse.json(alert);
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(error.message, 401);
    if (error instanceof ForbiddenError) return apiError(error.message, 403);

    return apiError(
      'No fue posible actualizar la alerta.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
