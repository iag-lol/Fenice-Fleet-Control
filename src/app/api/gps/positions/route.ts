import { handleApi, NO_STORE_HEADERS } from '@/lib/api';
import { loadFleetSnapshots } from '@/services/aggregation/fleet-aggregator';
import { getGpsProvider } from '@/services/registry';
import { fleetSimulator } from '@/services/gps/mock/simulator';
import type { LivePositionsPayload } from '@/types/views';

export const dynamic = 'force-dynamic';

/** Posiciones vivas + instantanea de flota. Fallback de polling del mapa. */
export async function GET(): Promise<Response> {
  const response = await handleApi<LivePositionsPayload>(async () => {
    const provider = getGpsProvider();
    const [positions, vehicles] = await Promise.all([
      provider.getAllCurrentPositions(),
      loadFleetSnapshots(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      positions,
      vehicles,
      simulator:
        provider.info.id === 'mock'
          ? { available: true, paused: fleetSimulator.isPaused() }
          : null,
    };
  }, 'las posiciones GPS');

  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
