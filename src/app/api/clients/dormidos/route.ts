import { handleApi } from '@/lib/api';
import { loadDormantClients } from '@/services/aggregation/client-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handleApi(async () => ({ clients: await loadDormantClients() }), 'los clientes dormidos');
}
