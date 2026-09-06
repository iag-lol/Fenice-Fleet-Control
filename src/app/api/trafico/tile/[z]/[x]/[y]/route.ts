import { apiError } from '@/lib/api';
import { getServerEnv } from '@/config/env';

export const dynamic = 'force-dynamic';

/**
 * Proxy de los tiles de TomTom Traffic Flow.
 *
 * `flowSegmentData` (usado por /api/trafico para el ETA y las alertas de
 * ruta) devuelve el tramo mas cercano a UN punto: sirve para "cuanto se
 * demora esta ruta", no para pintar el mapa completo de trafico, que
 * quedaba como un puñado de lineas sueltas en medio de una ciudad entera.
 * TomTom ofrece para eso un servicio de TILES (como los del mapa base) que
 * cubre todas las vias visibles con su color de congestion.
 *
 * La clave nunca llega al navegador: MapLibre pide los tiles a ESTA ruta
 * (relativa, sin clave), y aqui se reenvia la peticion a TomTom con la
 * clave puesta desde el servidor. Es el mismo patron que ya usa el resto de
 * la plataforma (Traccar, 3DTracking, la base de Fenice): ninguna
 * credencial sale del servidor.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ z: string; x: string; y: string }> },
): Promise<Response> {
  const env = getServerEnv();

  if (env.TRAFFIC_PROVIDER !== 'tomtom' || !env.TRAFFIC_API_KEY) {
    return apiError('El trafico en tiempo real requiere TRAFFIC_PROVIDER=tomtom y TRAFFIC_API_KEY.', 503);
  }

  const { z, x, y } = await params;
  if (![z, x, y].every((v) => /^\d+$/.test(v))) {
    return apiError('Coordenadas de tile invalidas.', 400);
  }

  const url = new URL(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png`);
  url.searchParams.set('key', env.TRAFFIC_API_KEY);
  url.searchParams.set('tileSize', '256');

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok || !upstream.body) {
      return apiError(`TomTom respondio ${upstream.status} al pedir el tile.`, 502);
    }

    // El trafico cambia cada pocos minutos: se cachea poco, no nada. Sin
    // cache, cada paneo/zoom del operador multiplicaria el gasto de cuota
    // innecesariamente para tiles que otro operador ya pidio segundos antes.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    });
  } catch (error) {
    return apiError(
      'No fue posible obtener el tile de trafico.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
