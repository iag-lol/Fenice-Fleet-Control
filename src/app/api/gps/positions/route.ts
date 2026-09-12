import { guardApi, handleApi, NO_STORE_HEADERS } from '@/lib/api';
import { loadFleetSnapshots } from '@/services/aggregation/fleet-aggregator';
import { getGpsProvider } from '@/services/registry';
import { fleetSimulator } from '@/services/gps/mock/simulator';
import type { LivePositionsPayload } from '@/types/views';

export const dynamic = 'force-dynamic';

/** Posiciones vivas + instantanea de flota. Fallback de polling del mapa. */
export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  const response = await handleApi<LivePositionsPayload>(async () => {
    const provider = getGpsProvider();

    const [positions, vehicles] = await Promise.all([
      provider.getAllCurrentPositions(),
      loadFleetSnapshots(),
    ]);

    // Sus metodos resuelven listas vacias en vez de fallar (ver
    // UnavailableGpsProvider): sin este chequeo, este fallback de polling
    // devolveria 200 con posiciones vacias para siempre y el cliente nunca se
    // enteraria de que el proveedor no esta conectado. Pero un vehiculo puede
    // estar conectado por "Conectar GPS" (Traccar) aunque el proveedor de
    // toda la flota este sin configurar, asi que solo se avisa cuando de
    // verdad no llego ninguna posicion.
    if (positions.length === 0 && provider.info.id === 'unavailable') {
      throw new Error('El proveedor de telemetria GPS no esta conectado.');
    }

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
