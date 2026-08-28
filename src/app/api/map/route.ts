import { handleApi } from '@/lib/api';
import { loadMapSnapshot } from '@/services/aggregation/dashboard-aggregator';

export const dynamic = 'force-dynamic';

/** Instantanea completa del mapa operacional: todas las capas en una llamada. */
export async function GET(): Promise<Response> {
  return handleApi(() => loadMapSnapshot(), 'la informacion del mapa');
}
