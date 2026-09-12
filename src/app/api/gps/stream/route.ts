import { guardApi } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import { loadFleetSnapshots } from '@/services/aggregation/fleet-aggregator';
import { fleetSimulator } from '@/services/gps/mock/simulator';
import { getGpsProvider } from '@/services/registry';
import { getOperationalSettings } from '@/services/settings/settings-store';
import type { LivePositionsPayload } from '@/types/views';

export const dynamic = 'force-dynamic';
/** El stream debe correr en Node: usa el proveedor GPS del servidor. */
export const runtime = 'nodejs';

/**
 * Tope de ejecucion de la funcion, en segundos.
 *
 * Lo respetan las plataformas sin servidor. Se declara aqui para que el
 * limite lo fije la aplicacion y no un valor por defecto de 10 s que cortaria
 * el stream a mitad de un evento.
 */
export const maxDuration = 60;

/**
 * Stream de posiciones por Server-Sent Events.
 *
 * Es el transporte preferido del mapa operacional: el navegador recibe cada
 * actualizacion sin recargar ni encuestar. Si el navegador o un proxy no
 * soportan SSE, el cliente degrada a polling contra /api/gps/positions sin
 * cambiar nada en la interfaz.
 *
 * El proxy tambien cumple una funcion de seguridad: cuando el proveedor sea
 * Traccar, las credenciales quedan en el servidor y el navegador solo ve este
 * endpoint.
 */
export async function GET(request: Request): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  const provider = getGpsProvider();
  const intervalMs = getOperationalSettings().gps.refreshIntervalMs;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const publish = async (): Promise<void> => {
        // El proveedor "unavailable" nunca lanza: sus metodos resuelven listas
        // vacias a proposito (ver UnavailableGpsProvider), para no tumbar
        // pantallas que no dependen de el. Por eso el motivo se revisa aqui
        // explicitamente, en vez de esperar a que el try/catch de abajo lo
        // detecte: sin esto, el operador ve "0 flota" para siempre y el
        // indicador del header se queda en "Conectando", sin decir nunca que
        // faltan credenciales.
        if (provider.info.id === 'unavailable') {
          send('gps-error', {
            message: 'El proveedor de telemetria GPS no esta conectado.',
            detail: 'Revisa las credenciales configuradas en el servidor.',
            at: new Date().toISOString(),
          });
          return;
        }

        try {
          const [positions, vehicles] = await Promise.all([
            provider.getAllCurrentPositions(),
            loadFleetSnapshots(),
          ]);

          const payload: LivePositionsPayload = {
            generatedAt: new Date().toISOString(),
            positions,
            vehicles,
            simulator:
              provider.info.id === 'mock'
                ? { available: true, paused: fleetSimulator.isPaused() }
                : null,
          };

          send('positions', payload);
        } catch (error) {
          send('gps-error', {
            message: 'Conexion GPS temporalmente no disponible.',
            detail: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
          });
        }
      };

      void publish();
      const timer = setInterval(() => void publish(), intervalMs);

      // Vida maxima del stream. Si un cliente desaparece sin que llegue su
      // senal de cierre, la conexion no queda retenida para siempre: el
      // navegador reconecta solo, porque EventSource reintenta por diseno.
      // Vida maxima configurable: debe quedar por debajo del limite de la
      // plataforma para cerrar limpiamente en vez de que nos maten.
      const maxLifetime = setTimeout(
        () => cleanup(),
        getServerEnv().GPS_STREAM_MAX_SECONDS * 1000,
      );

      // Latido: mantiene viva la conexion frente a proxies que cortan por
      // inactividad.
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(': keep-alive\n\n'));
          } catch {
            closed = true;
          }
        }
      }, 20_000);

      const cleanup = (): void => {
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        clearTimeout(maxLifetime);
        try {
          controller.close();
        } catch {
          // El cliente ya cerro la conexion.
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
