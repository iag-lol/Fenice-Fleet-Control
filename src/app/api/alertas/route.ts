import { handleApi } from '@/lib/api';
import { getOperationsProvider } from '@/services/registry';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return handleApi(async () => {
    const alerts = await getOperationsProvider().getAlerts();
    return { generatedAt: new Date().toISOString(), alerts };
  }, 'las alertas');
}
