import { guardApi, handleApi } from '@/lib/api';
import { BOUNDARY_METADATA, COMMUNES } from '@/data/communes';
import { loadCommuneOperationalSummary } from '@/services/aggregation/commune-aggregator';

export const dynamic = 'force-dynamic';

/**
 * Limites comunales oficiales con su resumen operacional.
 *
 * Endpoint propio y no parte de `/api/map` porque la geometria comunal pesa
 * varios cientos de kilobytes y la capa viene desactivada por defecto: no
 * tiene sentido enviarla en cada carga del mapa.
 */
export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  return handleApi(async () => {
    const summary = await loadCommuneOperationalSummary();

    return {
      metadata: BOUNDARY_METADATA,
      communes: COMMUNES.map((commune) => ({
        code: commune.code,
        name: commune.name,
        region: commune.region,
        center: commune.center,
        boundary: commune.boundary,
        summary: summary[commune.code] ?? null,
      })),
    };
  }, 'los limites comunales');
}
