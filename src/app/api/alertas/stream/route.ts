import { guardApi } from '@/lib/api';
import { getOperationsProvider } from '@/services/registry';
export const dynamic = 'force-dynamic';
export const maxDuration = 65;
export async function GET(request: Request): Promise<Response> {
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const encoder = new TextEncoder();
  let close: (() => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false; let running = false; let previous = '';
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { close?.(); }
      };
      const publish = async () => {
        if (closed || running) return; running = true;
        try {
          if (await guardApi('flota.ver')) { send('session-ended', {}); close?.(); return; }
          const alerts = await getOperationsProvider().getAlerts({ limit: 500 });
          const serialized = JSON.stringify(alerts);
          if (serialized !== previous) { send('alerts', { alerts }); previous = serialized; }
        } catch { send('unavailable', {}); }
        finally { running = false; }
      };
      const poll = setInterval(() => void publish(), 5_000);
      const heartbeat = setInterval(() => { if (!closed) try { controller.enqueue(encoder.encode(': heartbeat\n\n')); } catch { close?.(); } }, 20_000);
      const lifetime = setTimeout(() => close?.(), 55_000);
      close = () => {
        if (closed) return; closed = true;
        clearInterval(poll); clearInterval(heartbeat); clearTimeout(lifetime);
        request.signal.removeEventListener('abort', close!);
        try { controller.close(); } catch { /* Conexion ya cerrada. */ }
      };
      request.signal.addEventListener('abort', close);
      if (request.signal.aborted) close(); else void publish();
    },
    cancel() { close?.(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' } });
}
