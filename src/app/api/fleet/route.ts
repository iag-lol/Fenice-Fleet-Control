import { guardApi, handleApi } from '@/lib/api';
import { loadFleetSnapshots } from '@/services/aggregation/fleet-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi('flota.ver');
  if (denied) return denied;

  return handleApi(() => loadFleetSnapshots(), 'la flota');
}
