import { handleApi } from '@/lib/api';
import { loadTerritoryAnalysis } from '@/services/aggregation/client-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handleApi(() => loadTerritoryAnalysis(), 'el analisis territorial');
}
