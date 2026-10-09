import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, assertSameOrigin, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';
import { resolveSessionFromCookies } from '@/lib/session';
import { pushSubscriptionSchema } from '@/services/notifications/push-schema';
import { queueTestNotification } from '@/services/notifications/push-store';
import { dispatchPushJobs } from '@/services/notifications/push-dispatcher';
import { getSupabaseClient } from '@/lib/supabase/server-client';
export const dynamic = 'force-dynamic';
export async function GET(request: Request): Promise<Response> {
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const user = await resolveSessionFromCookies(); if (!user) return apiError('Inicia sesion.', 401);
  const id = z.string().uuid().safeParse(new URL(request.url).searchParams.get('id'));
  if (!id.success) return apiError('Prueba invalida.', 400);
  const { data, error } = await getSupabaseClient().from('notificaciones_envios')
    .select('estado,recibida_at,mostrada_at,notificaciones_suscripciones!inner(usuario_id,sesion_id)')
    .eq('id', id.data).eq('tipo', 'prueba').eq('notificaciones_suscripciones.usuario_id', user.id)
    .eq('notificaciones_suscripciones.sesion_id', user.sessionId).maybeSingle();
  if (error) return apiError('No fue posible consultar la prueba.', 503);
  if (!data) return apiError('Prueba no encontrada.', 404);
  return NextResponse.json({ state: data.estado, receivedAt: data.recibida_at, shownAt: data.mostrada_at }, { headers: NO_STORE_HEADERS });
}
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request); if (originError) return originError;
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const user = await resolveSessionFromCookies(); if (!user) return apiError('Inicia sesion.', 401);
  const parsed = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint }).safeParse(await readJsonBody(request, 6000));
  if (!parsed.success) return apiError('Suscripcion invalida.', 400);
  try {
    const id = await queueTestNotification(user, parsed.data.endpoint);
    if (!id) return apiError('Activa las notificaciones en este equipo antes de probarlas.', 404);
    await dispatchPushJobs();
    return NextResponse.json({ queued: true, testId: id }, { status: 202, headers: NO_STORE_HEADERS });
  } catch { return apiError('No se pudo enviar la prueba. Espera un minuto y revisa la conexion.', 503); }
}
