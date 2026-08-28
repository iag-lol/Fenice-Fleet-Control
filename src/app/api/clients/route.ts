import { handleApi } from '@/lib/api';
import { loadClientContext, toClientMapPoints } from '@/services/aggregation/client-aggregator';

export const dynamic = 'force-dynamic';

/**
 * Clientes con su estado comercial ya calculado. Se devuelve la proyeccion de
 * mapa, que es tambien la que alimenta tablas y filtros: un solo formato
 * evita que la lista y el mapa muestren estados distintos.
 */
export async function GET(): Promise<Response> {
  return handleApi(async () => {
    const { snapshots } = await loadClientContext();
    return { generatedAt: new Date().toISOString(), clients: toClientMapPoints(snapshots) };
  }, 'los clientes');
}
