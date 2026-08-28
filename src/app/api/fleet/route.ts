import { handleApi } from '@/lib/api';
import { loadFleetSnapshots } from '@/services/aggregation/fleet-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handleApi(() => loadFleetSnapshots(), 'la flota');
}
