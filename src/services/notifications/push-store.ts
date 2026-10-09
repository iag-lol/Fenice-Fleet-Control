import 'server-only';
import { createHash } from 'node:crypto';
import { getSupabaseClient } from '@/lib/supabase/server-client';
import { protectSensitive } from '@/lib/sensitive-data';
import type { SessionUser } from '@/lib/session';
import { pushPreferencesSchema, pushSubscriptionSchema } from './push-schema';
import type { z } from 'zod';

export const subscriptionHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');
export async function savePushSubscription(user: SessionUser, subscription: z.infer<typeof pushSubscriptionSchema>, preferences: z.infer<typeof pushPreferencesSchema>): Promise<string> {
  const hash = subscriptionHash(subscription.endpoint);
  const { data, error } = await getSupabaseClient().rpc('fenice_save_push_subscription', {
    p_user: user.id, p_session: user.sessionId, p_hash: hash,
    p_cipher: protectSensitive(JSON.stringify(subscription), `push-subscription:${hash}`),
    p_sound: preferences.sound, p_preview: preferences.preview, p_severity: preferences.minSeverity,
  });
  if (error || !data) throw new Error('No fue posible guardar la suscripcion.');
  return data as string;
}

export async function disablePushSubscription(userId: string, endpoint: string): Promise<void> {
  const { error } = await getSupabaseClient().from('notificaciones_suscripciones')
    .update({ habilitada: false }).eq('usuario_id', userId).eq('endpoint_hash', subscriptionHash(endpoint));
  if (error) throw new Error('No fue posible desactivar la suscripcion.');
}

export async function queueTestNotification(user: SessionUser, endpoint: string): Promise<string | null> {
  const sb = getSupabaseClient();
  const { data, error } = await sb.from('notificaciones_suscripciones').select('id')
    .eq('usuario_id', user.id).eq('sesion_id', user.sessionId)
    .eq('endpoint_hash', subscriptionHash(endpoint)).eq('habilitada', true).maybeSingle<{ id: string }>();
  if (error) throw new Error('No fue posible consultar la suscripcion.');
  if (!data) return null;
  // Limitar pruebas tambien en la base, no solo en el navegador.
  const { count, error: rateError } = await sb.from('notificaciones_envios').select('id', { count: 'exact', head: true })
    .eq('suscripcion_id', data.id).eq('tipo', 'prueba').gte('creado_at', new Date(Date.now() - 60_000).toISOString());
  if (rateError) throw new Error('No fue posible verificar el limite de pruebas.');
  if ((count ?? 0) >= 3) throw new Error('Espera un minuto antes de enviar otra prueba.');
  const { data: job, error: jobError } = await sb.from('notificaciones_envios')
    .insert({ suscripcion_id: data.id, tipo: 'prueba' }).select('id').single<{ id: string }>();
  if (jobError || !job) throw new Error('No fue posible programar la prueba.');
  return job.id;
}
