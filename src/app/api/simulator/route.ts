import { z } from 'zod';

import { apiError, assertSameOrigin, guardApi, handleApi } from '@/lib/api';
import { fleetSimulator } from '@/services/gps/mock/simulator';
import { getGpsProvider } from '@/services/registry';

export const dynamic = 'force-dynamic';

/** Estado del simulador GPS de demostracion. */
export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  if (getGpsProvider().info.id !== 'mock') {
    return handleApi(async () => ({ available: false }), 'el estado del simulador');
  }
  return handleApi(async () => ({ available: true, ...fleetSimulator.getStatus() }), 'el estado del simulador');
}

const commandSchema = z.object({ action: z.enum(['pause', 'resume']) });

/**
 * Pausa o reanuda la simulacion. Solo tiene efecto en modo demostracion:
 * con GPS real no existe nada que pausar.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('configuracion.editar');
  if (denied) return denied;

  if (getGpsProvider().info.id !== 'mock') {
    return apiError('El simulador solo esta disponible con GPS_PROVIDER=mock.', 409);
  }

  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Comando invalido. Se espera { "action": "pause" | "resume" }.', 400);
  }

  if (parsed.data.action === 'pause') fleetSimulator.pause();
  else fleetSimulator.resume();

  return handleApi(async () => ({ available: true, ...fleetSimulator.getStatus() }), 'el estado del simulador');
}
