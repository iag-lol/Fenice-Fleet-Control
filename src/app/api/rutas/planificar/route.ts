import { z } from 'zod';

import { apiError, assertSameOrigin, guardApi, handleApi } from '@/lib/api';
import { planDrivingRoute } from '@/services/eta/eta-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  // En el orden en que el vehiculo debe visitarlas.
  paradas: z.array(z.object({ lat: z.number(), lng: z.number() })).min(2).max(25),
});

/**
 * Calcula el trazado real por calles para una ruta con varias paradas.
 *
 * Pensado para quien crea o importa una ruta (hoy, un proceso externo que
 * inserta directo en `rutas`/`paradas_ruta`, ver `supabase/schema.sql`):
 * se llama aqui ANTES de guardar, con las paradas en el orden de visita, y
 * el `trayecto` resultante se guarda como `trazado_planificado` en vez de
 * conectar las paradas con una linea recta.
 *
 * `fuente: 'directa'` en la respuesta avisa que no hay proveedor de ruteo
 * real configurado (`ROUTING_PROVIDER=osrm` + `OSRM_BASE_URL`): en ese caso
 * el trayecto devuelto son las mismas paradas sin ninguna curva agregada,
 * nunca una geometria vial inventada.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('rutas.editar');
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Se esperan al menos 2 paradas, cada una con lat y lng validos.', 400);
  }

  return handleApi(async () => {
    const plan = await planDrivingRoute(parsed.data.paradas);
    return {
      trayecto: plan.path,
      distanciaKm: plan.distanceKm,
      duracionMinutos: plan.durationMinutes,
      fuente: plan.source === 'routing_provider' ? 'ruteo_real' : 'directa',
    };
  }, 'el trazado de la ruta');
}
