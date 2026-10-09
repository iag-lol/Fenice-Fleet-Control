import 'server-only';
import webPush from 'web-push';
import { getServerEnv } from '@/config/env';
import { getSupabaseClient } from '@/lib/supabase/server-client';
import { unprotectSensitive } from '@/lib/sensitive-data';
import { pushSubscriptionSchema } from './push-schema';

export interface PushJob {
  id: string; lease_token: string; suscripcion_id: string; endpoint_hash: string;
  suscripcion_cifrada: string; sonido: boolean; mostrar_detalle: boolean;
  tipo: 'alerta' | 'prueba'; intentos: number; alerta_id: string | null; revision: number;
  severidad: 'info' | 'warning' | 'critical' | null; titulo: string | null;
  descripcion: string | null; marca_tiempo: string | null;
}
export function pushConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY && env.DATA_ENCRYPTION_KEY);
}
export function notificationPayload(job: PushJob) {
  const test = job.tipo === 'prueba';
  return {
    deliveryId: job.id,
    title: test ? 'Prueba de Fenice Fleet Control' : job.mostrar_detalle ? (job.titulo ?? 'Nueva alerta').slice(0, 120) : 'Fenice Fleet Control',
    body: test ? 'Esta es una notificación de prueba. Abre la aplicación para confirmar su recepción.'
      : job.mostrar_detalle ? (job.descripcion ?? 'Hay una nueva alerta operacional.').slice(0, 350)
      : 'Hay una nueva alerta operacional. Abre la aplicación para revisarla.',
    tag: test ? `fenice-test-${job.id}` : `fenice-alert-${job.alerta_id}`,
    alertId: job.alerta_id, revision: job.revision, severity: job.severidad ?? 'info',
    url: job.alerta_id ? `/alertas?alerta=${encodeURIComponent(job.alerta_id)}` : '/alertas',
    sound: job.sonido, test, timestamp: job.marca_tiempo ? Date.parse(job.marca_tiempo) : Date.now(),
  };
}
export function deliveryOutcome(status: number | null, attempts: number) {
  if (status !== null && status >= 200 && status < 300) return { state: 'enviada', disable: false, retrySeconds: 0 };
  if (status === 404 || status === 410) return { state: 'cancelada', disable: true, retrySeconds: 0 };
  const transient = status === null || status === 429 || status >= 500;
  return { state: transient && attempts < 6 ? 'pendiente' : 'fallida', disable: false,
    retrySeconds: Math.min(300, 5 * 2 ** Math.min(attempts, 6)) };
}

export async function dispatchPushJobs(): Promise<number> {
  if (!pushConfigured()) return 0;
  const sb = getSupabaseClient(); const env = getServerEnv();
  const { data, error } = await sb.rpc('fenice_claim_notifications', { p_limit: 20 });
  if (error) throw new Error('No fue posible consultar la cola de notificaciones.');
  const jobs = (data ?? []) as PushJob[];
  // No solicitar decenas de envios a la vez; la flota inicial tiene pocos equipos.
  for (let offset = 0; offset < jobs.length; offset += 3) {
    await Promise.all(jobs.slice(offset, offset + 3).map(async (job) => {
      const { data: allowed, error: accessError } = await sb.rpc('fenice_notification_authorized', {
        p_job: job.id, p_lease: job.lease_token,
      });
      if (accessError) throw new Error('No fue posible validar el destinatario.');
      if (!allowed) {
        await sb.from('notificaciones_envios').update({ estado: 'cancelada', lease_until: null })
          .eq('id', job.id).eq('lease_token', job.lease_token);
        return;
      }
      let status: number | null = null;
      try {
        const subscription = pushSubscriptionSchema.parse(JSON.parse(unprotectSensitive(job.suscripcion_cifrada, `push-subscription:${job.endpoint_hash}`)));
        const result = await webPush.sendNotification(subscription, JSON.stringify(notificationPayload(job)), {
          vapidDetails: { subject: env.WEB_PUSH_SUBJECT, publicKey: env.WEB_PUSH_PUBLIC_KEY!, privateKey: env.WEB_PUSH_PRIVATE_KEY! },
          TTL: job.severidad === 'critical' ? 900 : 300, urgency: job.severidad === 'critical' ? 'high' : 'normal',
          timeout: 10_000,
        });
        status = result.statusCode;
      } catch (failure) {
        if (failure instanceof Error && 'statusCode' in failure && typeof failure.statusCode === 'number') status = failure.statusCode;
        // Nunca registrar endpoint, claves, payload ni cuerpo del proveedor.
      }
      const result = deliveryOutcome(status, job.intentos);
      if (result.disable) await sb.from('notificaciones_suscripciones').update({ habilitada: false })
        .eq('id', job.suscripcion_id).eq('suscripcion_cifrada', job.suscripcion_cifrada);
      const { error: saveError } = await sb.from('notificaciones_envios').update({
        estado: result.state, lease_until: null,
        proximo_intento_at: new Date(Date.now() + result.retrySeconds * 1000).toISOString(),
        enviado_at: result.state === 'enviada' ? new Date().toISOString() : null,
        ultimo_codigo: status === null ? 'network_or_payload' : String(status),
      }).eq('id', job.id).eq('lease_token', job.lease_token).eq('estado', 'procesando');
      if (saveError) throw new Error('No fue posible confirmar el estado del envio.');
    }));
  }
  return jobs.length;
}
