import { handleApi } from '@/lib/api';
import { getTrafficProvider } from '@/services/traffic/traffic-provider';

export const dynamic = 'force-dynamic';

/**
 * Congestion vial actual.
 *
 * Devuelve siempre la disponibilidad del proveedor junto a los datos, para que
 * la interfaz pueda distinguir "no hay congestion" de "no lo sabemos".
 * Confundir ambas cosas seria el peor resultado posible de esta capa.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  return handleApi(async () => {
    const provider = getTrafficProvider();

    if (!provider.info.available) {
      return { provider: provider.info, segments: [] };
    }

    const bounds = {
      minLat: Number(url.searchParams.get('minLat') ?? '-33.72'),
      maxLat: Number(url.searchParams.get('maxLat') ?? '-33.28'),
      minLng: Number(url.searchParams.get('minLng') ?? '-70.87'),
      maxLng: Number(url.searchParams.get('maxLng') ?? '-70.45'),
    };

    return { provider: provider.info, segments: await provider.getSegments(bounds) };
  }, 'el trafico actual');
}
