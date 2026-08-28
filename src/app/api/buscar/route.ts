import { handleApi } from '@/lib/api';
import { searchGlobal } from '@/services/aggregation/search-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams.get('q') ?? '';
  return handleApi(async () => ({ query, results: await searchGlobal(query) }), 'los resultados de busqueda');
}
