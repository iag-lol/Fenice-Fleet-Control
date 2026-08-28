import { apiError, handleApi } from '@/lib/api';
import { ForbiddenError, requirePermission, UnauthorizedError } from '@/lib/auth';
import {
  getOperationalSettings,
  resetOperationalSettings,
  updateOperationalSettings,
} from '@/services/settings/settings-store';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Control de acceso a la escritura de configuracion. Inerte mientras
 * AUTH_ENABLED=false; al activarla, aqui se aplica sin cambiar la UI.
 */
async function guardWrite(): Promise<Response | null> {
  try {
    await requirePermission('configuracion.editar');
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(error.message, 401);
    if (error instanceof ForbiddenError) return apiError(error.message, 403);
    throw error;
  }
}

export async function GET(): Promise<Response> {
  return handleApi(async () => getOperationalSettings(), 'la configuracion operacional');
}

/** Aplica una nueva configuracion. Los motores la toman en la siguiente lectura. */
export async function PUT(request: Request): Promise<Response> {
  const denied = await guardWrite();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const result = updateOperationalSettings(body);

  if (!result.ok) {
    return NextResponse.json(
      { error: 'La configuracion no es valida.', issues: result.errors },
      { status: 400 },
    );
  }

  return NextResponse.json(result.settings);
}

/** Restaura los valores definidos por variables de entorno. */
export async function DELETE(): Promise<Response> {
  const denied = await guardWrite();
  if (denied) return denied;

  try {
    return NextResponse.json(resetOperationalSettings());
  } catch (error) {
    return apiError(
      'No fue posible restaurar la configuracion.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
