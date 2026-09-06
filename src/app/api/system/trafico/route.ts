import { NextResponse } from 'next/server';

import { guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import { getTrafficProvider } from '@/services/traffic/traffic-provider';

export const dynamic = 'force-dynamic';

/**
 * Diagnostico de la conexion al proveedor de trafico (TomTom/Mapbox/Google).
 *
 * `getSegments()` descartaba en silencio cualquier tramo que fallara: una
 * clave invalida, vencida o sin el producto contratado dejaba el mapa "sin
 * una sola linea de trafico" sin ningun mensaje que lo explicara. Este
 * endpoint hace UNA consulta real de prueba y devuelve el motivo exacto
 * cuando falla (el mismo texto que devolveria el proveedor: clave invalida,
 * cuota agotada, etc.). Nunca devuelve la clave en si.
 */
export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  const env = getServerEnv();
  const provider = getTrafficProvider();

  const health = await provider.healthCheck();

  const response = NextResponse.json({
    provider: provider.info.id,
    label: provider.info.label,
    configurado: env.TRAFFIC_PROVIDER !== 'none',
    claveProvista: Boolean(env.TRAFFIC_API_KEY),
    ok: health.ok,
    message: health.message,
    latencyMs: health.latencyMs,
    checkedAt: new Date().toISOString(),
  });
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
