import { handleApi, NO_STORE_HEADERS } from '@/lib/api';
import { getSystemMode } from '@/services/registry';
import { getOperationalSettings } from '@/services/settings/settings-store';
import { getProductConfig } from '@/product/plans';

export const dynamic = 'force-dynamic';

/** Modo del sistema e indicadores de configuracion. Sin secretos. */
export async function GET(): Promise<Response> {
  const response = await handleApi(
    async () => ({
      ...getSystemMode(),
      // El plan contratado gobierna que se puede usar: exponerlo permite
      // diagnosticar de inmediato una entrega mal configurada.
      product: getProductConfig(),
      settings: getOperationalSettings(),
    }),
    'el estado del sistema',
  );
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
