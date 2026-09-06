import { assertSameOrigin, getClientIp, guardApi, handleApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import {
  getOperationalSettings,
  resetOperationalSettings,
  updateOperationalSettings,
} from '@/services/settings/settings-store';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  return handleApi(async () => getOperationalSettings(), 'la configuracion operacional');
}

/** Aplica una nueva configuracion. Los motores la toman en la siguiente lectura. */
export async function PUT(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('configuracion.editar');
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const result = await updateOperationalSettings(body);

  if (!result.ok) {
    return NextResponse.json(
      { error: 'La configuracion no es valida.', issues: result.errors },
      { status: 400 },
    );
  }

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'configuracion.editar',
    entity: 'configuracion_operacional',
    ip: getClientIp(request),
  });

  return NextResponse.json(result.settings);
}

/** Restaura los valores definidos por variables de entorno. */
export async function DELETE(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('configuracion.editar');
  if (denied) return denied;

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'configuracion.restaurar',
    entity: 'configuracion_operacional',
    ip: getClientIp(request),
  });

  return handleApi(() => resetOperationalSettings(), 'la configuracion operacional');
}
