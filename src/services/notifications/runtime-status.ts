import 'server-only';
const runtime = globalThis as unknown as { __feniceAlertRuntime?: { started: boolean; lastTick: number | null; lastEvaluation: number | null; error: boolean } };
export function notificationRuntime() {
  return runtime.__feniceAlertRuntime ??= { started: false, lastTick: null, lastEvaluation: null, error: false };
}
