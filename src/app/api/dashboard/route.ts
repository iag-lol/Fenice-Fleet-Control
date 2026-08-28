import { handleApi } from '@/lib/api';
import { loadDashboard } from '@/services/aggregation/dashboard-aggregator';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handleApi(() => loadDashboard(), 'los indicadores del panel');
}
