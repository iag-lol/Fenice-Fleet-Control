import { guardApi, handleApi } from '@/lib/api';
import { loadTerritoryAnalysis } from '@/services/aggregation/client-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi('clientes.ver');
  if (denied) return denied;

  return handleApi(() => loadTerritoryAnalysis(), 'el analisis territorial');
}
