import { guardApi, handleApi } from '@/lib/api';
import { loadDashboard } from '@/services/aggregation/dashboard-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  return handleApi(() => loadDashboard(), 'los indicadores del panel');
}
