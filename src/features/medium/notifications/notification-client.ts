import type { Alert, AlertSeverity } from '@/types/core';

export const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };
export interface NotificationPreferences { sound: boolean; desktop: boolean; preview: boolean; minSeverity: AlertSeverity }
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { sound: true, desktop: false, preview: false, minSeverity: 'info' };
export const NOTIFICATION_PREFERENCES_KEY = 'fenice.alertas.avisos.v2';
export function parseNotificationPreferences(raw: string | null): NotificationPreferences {
  try {
    const value = JSON.parse(raw ?? '{}') as Partial<NotificationPreferences>;
    return { sound: typeof value.sound === 'boolean' ? value.sound : true,
      desktop: typeof value.desktop === 'boolean' ? value.desktop : false,
      preview: value.preview === true,
      minSeverity: value.minSeverity && value.minSeverity in SEVERITY_RANK ? value.minSeverity : 'info' };
  } catch { return { ...DEFAULT_NOTIFICATION_PREFERENCES }; }
}
export const alertRevisionKey = (alert: Alert) => `${alert.state}:${alert.notificationRevision ?? 1}:${alert.severity}`;
export function newRelevantAlerts(alerts: Alert[], known: Map<string, string> | null, minSeverity: AlertSeverity): Alert[] {
  if (!known) return [];
  return alerts.filter(a => a.state === 'nueva' && known.get(a.id) !== alertRevisionKey(a) && SEVERITY_RANK[a.severity] >= SEVERITY_RANK[minSeverity])
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}
export async function notificationRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador no permite notificaciones de la aplicación.');
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('La aplicación no pudo preparar los avisos. Recarga e inténtalo nuevamente.')), 12_000);
  })]); } finally { if (timeout) clearTimeout(timeout); }
}
function publicKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
export async function subscribeDevice(preferences: NotificationPreferences): Promise<PushSubscription> {
  const response = await fetch('/api/notificaciones', { cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Inicia sesión para activar los avisos.' : 'No fue posible consultar las notificaciones.');
  const status = await response.json() as { configured: boolean; publicKey: string | null; workerRunning: boolean };
  if (!status.configured || !status.publicKey || !status.workerRunning) throw new Error('El servicio de notificaciones está iniciando. Inténtalo nuevamente en unos segundos.');
  const registration = await notificationRegistration();
  let subscription = await registration.pushManager.getSubscription();
  const key = publicKeyBytes(status.publicKey);
  if (subscription?.options.applicationServerKey) {
    const actual = new Uint8Array(subscription.options.applicationServerKey);
    if (actual.length !== key.length || actual.some((b, i) => b !== key[i])) { await subscription.unsubscribe(); subscription = null; }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const saved = await fetch('/api/notificaciones', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON(), preferences }) });
  if (!saved.ok) throw new Error('No se pudo vincular este equipo. Revisa la conexión e inténtalo otra vez.');
  return subscription;
}
export async function unsubscribeDevice(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  const response = await fetch('/api/notificaciones', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
  if (!response.ok && response.status !== 401) throw new Error('No se pudo desactivar este equipo. Inténtalo nuevamente.');
  await subscription.unsubscribe();
}
