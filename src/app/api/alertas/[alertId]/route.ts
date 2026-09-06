import { z } from 'zod';

import { apiError, assertSameOrigin, getClientIp, guardApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
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
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const { alertId } = await params;

  const denied = await guardApi('alertas.resolver');
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Estado invalido. Valores permitidos: nueva, revisada, resuelta.', 400);
  }

  try {
    const alert = await getOperationsProvider().updateAlertState(
      asAlertId(alertId),
      parsed.data.state,
    );
    if (!alert) return apiError('Alerta no encontrada.', 404);

    const context = await getAuthContext();
    void logAction({
      userId: context.userId,
      action: 'alerta.cambiar_estado',
      entity: 'alertas',
      entityId: alertId,
      detail: { estado: parsed.data.state },
      ip: getClientIp(request),
    });

    return NextResponse.json(alert);
  } catch (error) {
    return apiError(
      'No fue posible actualizar la alerta.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
