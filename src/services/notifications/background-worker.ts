import 'server-only';
import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import { notificationRuntime } from './runtime-status';
import { dispatchPushJobs } from './push-dispatcher';
import { evaluateRealAlerts } from './real-alert-evaluator';

export function startAlertWorker(): void {
  const env = getServerEnv(); const state = notificationRuntime();
  if (!env.ALERT_WORKER_ENABLED || !isSupabaseConfigured() || state.started) return;
  state.started = true;
  let dispatching = false; let evaluating = false; let stopped = false; let cleanupAt = 0;
  const dispatch = async () => {
    if (dispatching || stopped) return; dispatching = true;
    try {
      await dispatchPushJobs(); state.lastTick = Date.now(); state.error = false;
      if (Date.now() - cleanupAt > 3_600_000) {
        const sb = getSupabaseClient();
        await sb.from('notificaciones_envios').delete().lt('creado_at', new Date(Date.now() - 7 * 86_400_000).toISOString());
        cleanupAt = Date.now();
      }
    } catch { state.error = true; console.error('[alert-worker] No fue posible procesar la cola de notificaciones.'); }
    finally { dispatching = false; }
  };
  const evaluate = async () => {
    if (evaluating || stopped) return; evaluating = true;
    try { await evaluateRealAlerts(); state.lastEvaluation = Date.now(); }
    catch { console.error('[alert-worker] Evaluacion temporalmente no disponible; no se generan datos ficticios.'); }
    finally { evaluating = false; }
  };
  const sender = setInterval(() => void dispatch(), 5000); sender.unref();
  const evaluator = setInterval(() => void evaluate(), Math.max(10_000, env.GPS_REFRESH_INTERVAL_MS)); evaluator.unref();
  const stop = () => { stopped = true; clearInterval(sender); clearInterval(evaluator); state.started = false; };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  void dispatch(); void evaluate();
  // Registro de arranque sin datos de clientes, endpoints ni claves.
  // eslint-disable-next-line no-console
  console.info('[alert-worker] Evaluacion de alertas y envio de notificaciones iniciados.');
}
