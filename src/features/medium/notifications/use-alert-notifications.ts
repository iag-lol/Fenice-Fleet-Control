'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { playAlertSound, primeAlertSound } from '@/lib/alert-sound';
import type { Alert } from '@/types/core';
import {
  alertRevisionKey, DEFAULT_NOTIFICATION_PREFERENCES, newRelevantAlerts,
  NOTIFICATION_PREFERENCES_KEY, parseNotificationPreferences, subscribeDevice, unsubscribeDevice,
  type NotificationPreferences,
} from './notification-client';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';
export type AlertPreferences = NotificationPreferences;
export interface AlertNotificationsState {
  visible: Alert[]; dismiss: (id: string) => void; dismissAll: () => void;
  preferences: AlertPreferences; setPreferences: (next: Partial<AlertPreferences>) => void;
  permission: NotificationPermissionState; requestPermission: () => Promise<void>;
  pushActive: boolean; busy: boolean; error: string | null; feedback: string | null;
  installRequired: boolean; connected: boolean; sendTest: () => Promise<void>; testSound: () => Promise<void>;
}
export function useAlertNotifications(): AlertNotificationsState {
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState<Alert[]>([]);
  const [preferences, setPrefs] = useState<AlertPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [permission, setPermission] = useState<NotificationPermissionState>('unsupported');
  const [pushActive, setPushActive] = useState(false); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [feedback, setFeedback] = useState<string | null>(null);
  const [installRequired, setInstallRequired] = useState(false); const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const preferencesRef = useRef(preferences); preferencesRef.current = preferences;
  const pushActiveRef = useRef(pushActive); pushActiveRef.current = pushActive;
  const known = useRef<Map<string, string> | null>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const syncQueue = useRef<Promise<unknown>>(Promise.resolve());
  const dismissed = useRef(new Set<string>());

  useEffect(() => {
    let initial = DEFAULT_NOTIFICATION_PREFERENCES;
    try {
      const stored = window.localStorage.getItem(NOTIFICATION_PREFERENCES_KEY);
      if (stored) initial = parseNotificationPreferences(stored);
      else {
        const old = parseNotificationPreferences(window.localStorage.getItem('fenice.alertas.avisos'));
        initial = { ...old, preview: false, minSeverity: 'info' };
      }
    } catch { /* Preferencias en memoria si el navegador bloquea almacenamiento. */ }
    setPrefs(initial); setLoaded(true);
    const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstallRequired(appleMobile && !installed);
    const updatePermission = () => setPermission('Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator
      ? Notification.permission : 'unsupported');
    updatePermission(); window.addEventListener('focus', updatePermission);
    return () => window.removeEventListener('focus', updatePermission);
  }, []);

  const setPreferences = useCallback((patch: Partial<AlertPreferences>) => {
    setPrefs(current => {
      const next = { ...current, ...patch };
      try { window.localStorage.setItem(NOTIFICATION_PREFERENCES_KEY, JSON.stringify(next)); } catch { /* En memoria. */ }
      return next;
    });
  }, []);
  const syncDevice = useCallback((next: AlertPreferences) => {
    const run = syncQueue.current.catch(() => {}).then(async () => {
      setBusy(true);
      try { await subscribeDevice(next); setPushActive(true); setError(null); }
      catch (failure) { setPushActive(false); setError(failure instanceof Error ? failure.message : 'No se pudo activar este equipo.'); throw failure; }
      finally { setBusy(false); }
    });
    syncQueue.current = run;
    return run;
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (preferences.desktop && permission === 'granted' && !installRequired) {
      const timer = setTimeout(() => void syncDevice(preferences).catch(() => {}), 250);
      return () => clearTimeout(timer);
    }
    setPushActive(false);
    // Solo desuscribir si el usuario eligio apagar avisos: no al montar ni al cerrar otra pestaña.
  }, [loaded, preferences, permission, installRequired, syncDevice]);

  const requestPermission = useCallback(async () => {
    primeAlertSound(); setFeedback(null); setError(null);
    if (installRequired) { setError('Añade Fenice a la pantalla de inicio y abre la aplicación para activar los avisos.'); return; }
    if (permission === 'unsupported' || !window.isSecureContext) { setError('Usa la aplicación instalada en un navegador actualizado con HTTPS.'); return; }
    setBusy(true);
    try {
      // Debe ser la primera operacion asincrona del gesto del usuario en iOS.
      const result = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') { setError('Permite los avisos de Fenice en los ajustes de notificaciones de este equipo.'); return; }
      const next = { ...preferencesRef.current, desktop: true };
      await syncDevice(next); setPreferences(next);
      setFeedback('Notificaciones activas en este equipo. Usa la prueba para comprobar el aviso y su sonido.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No fue posible activar los avisos.'); }
    finally { setBusy(false); }
  }, [installRequired, permission, setPreferences, syncDevice]);

  const updatePreferences = useCallback((patch: Partial<AlertPreferences>) => {
    if (patch.desktop === false) {
      setBusy(true);
      void unsubscribeDevice().then(() => { setPreferences(patch); setPushActive(false); setError(null); })
        .catch(failure => setError(failure instanceof Error ? failure.message : 'No se pudo desactivar este equipo.'))
        .finally(() => setBusy(false));
    } else setPreferences(patch);
  }, [setPreferences]);

  const dismiss = useCallback((id: string) => {
    dismissed.current.add(id); setVisible(current => current.filter(a => a.id !== id));
    const timer = timers.current.get(id); if (timer) clearTimeout(timer); timers.current.delete(id);
  }, []);
  const dismissAll = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); setVisible([]);
  }, []);

  useEffect(() => {
    let stopped = false; let reviewing = false; let sseLive = false;
    const receive = (alerts: Alert[]) => {
      if (stopped || !Array.isArray(alerts)) return;
      const incoming = newRelevantAlerts(alerts, known.current, preferencesRef.current.minSeverity);
      known.current = new Map(alerts.map(a => [a.id, alertRevisionKey(a)]));
      queryClient.setQueryData(['alerts'], { alerts });
      queryClient.setQueryData(['alerts', 'summary'], { alerts });
      setVisible(current => current.filter(a => alerts.some(b => b.id === a.id && b.state === 'nueva')));
      if (!incoming.length) return;
      for (const alert of incoming) dismissed.current.delete(alert.id);
      setVisible(current => [...incoming, ...current.filter(a => !incoming.some(b => b.id === a.id))].slice(0, 4));
      // Push usa el sonido del sistema. Evitar un segundo tono por cada pestaña abierta.
      if (preferencesRef.current.sound && !pushActiveRef.current && document.visibilityState === 'visible' && document.hasFocus()) {
        void playAlertSound(incoming[0]!.severity);
      }
      for (const alert of incoming) {
        const previous = timers.current.get(alert.id); if (previous) clearTimeout(previous);
        if (alert.severity !== 'critical') timers.current.set(alert.id, setTimeout(() => dismiss(alert.id), 12_000));
      }
    };
    const poll = async () => {
      if (stopped || reviewing) return; reviewing = true;
      try {
        const response = await fetch('/api/alertas', { cache: 'no-store' });
        if (response.status === 401 || response.status === 403) { stopped = true; source?.close(); setVisible([]); setPushActive(false); return; }
        if (!response.ok) throw new Error('unavailable');
        const result = await response.json() as { alerts: Alert[] }; receive(result.alerts);
      } catch { setConnected(false); } finally { reviewing = false; }
    };
    const source = typeof EventSource === 'undefined' ? null : new EventSource('/api/alertas/stream');
    source?.addEventListener('open', () => { sseLive = true; setConnected(true); });
    source?.addEventListener('alerts', event => {
      try { receive((JSON.parse((event as MessageEvent).data) as { alerts: Alert[] }).alerts); } catch { setConnected(false); }
    });
    source?.addEventListener('unavailable', () => { sseLive = false; setConnected(false); void poll(); });
    source?.addEventListener('session-ended', () => { stopped = true; source.close(); setConnected(false); setVisible([]); setPushActive(false); });
    source?.addEventListener('error', () => { sseLive = false; setConnected(false); void poll(); });
    const fallback = setInterval(() => { if (!sseLive) void poll(); }, 5_000);
    const refresh = () => { if (document.visibilityState === 'visible') void poll(); };
    const pushMessage = (event: MessageEvent) => {
      if (event.data?.type === 'fenice:push-received') { void poll(); void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); }
    };
    document.addEventListener('visibilitychange', refresh); window.addEventListener('online', refresh);
    navigator.serviceWorker?.addEventListener('message', pushMessage);
    if (!source) void poll();
    return () => {
      stopped = true; source?.close(); clearInterval(fallback);
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('online', refresh);
      navigator.serviceWorker?.removeEventListener('message', pushMessage);
    };
  }, [dismiss, queryClient]);

  const sendTest = useCallback(async () => {
    setBusy(true); setError(null); setFeedback(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription || !pushActiveRef.current) throw new Error('Activa las notificaciones de este equipo antes de probarlas.');
      const response = await fetch('/api/notificaciones/prueba', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
      if (!response.ok) throw new Error('No se pudo enviar la prueba. Revisa la conexión y vuelve a intentarlo.');
      const result = await response.json() as { testId: string };
      setFeedback('Prueba enviada al servicio. Esperando la confirmación de este equipo…');
      for (let attempt = 0; attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const receipt = await fetch(`/api/notificaciones/prueba?id=${encodeURIComponent(result.testId)}`, { cache: 'no-store' });
        if (!receipt.ok) break;
        const status = await receipt.json() as { state: string; shownAt: string | null };
        if (status.shownAt) { setFeedback('Este equipo recibió y mostró la prueba. Confirma el sonido en su centro de notificaciones.'); return; }
        if (status.state === 'fallida' || status.state === 'cancelada') throw new Error('No se pudo entregar la prueba. Reactiva este equipo y revisa sus permisos.');
      }
      setFeedback('La recepción todavía no está confirmada. Revisa el centro de notificaciones y los permisos del sistema.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo realizar la prueba.'); }
    finally { setBusy(false); }
  }, []);
  const testSound = useCallback(async () => {
    primeAlertSound(); const played = await playAlertSound('warning');
    setFeedback(played ? 'Se reprodujo el tono de Fenice con la aplicación abierta.' : 'Interactúa con la aplicación y revisa el volumen para probar el sonido.');
  }, []);
  useEffect(() => { const pending = timers.current; return () => { for (const timer of pending.values()) clearTimeout(timer); }; }, []);
  return { visible, dismiss, dismissAll, preferences, setPreferences: updatePreferences, permission, requestPermission,
    pushActive, busy, error, feedback, installRequired, connected, sendTest, testSound };
}
