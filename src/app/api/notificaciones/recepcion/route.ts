import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, assertSameOrigin, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { readJsonBody } from '@/lib/request-body';
import { resolveSessionFromCookies } from '@/lib/session';
import { getSupabaseClient } from '@/lib/supabase/server-client';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request); if (originError) return originError;
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const user = await resolveSessionFromCookies(); if (!user) return apiError('Inicia sesion.', 401);
  const parsed = z.object({ deliveryId: z.string().uuid(), phase: z.enum(['received', 'shown']) }).safeParse(await readJsonBody(request, 2048));
  if (!parsed.success) return apiError('Confirmacion invalida.', 400);
  const sb = getSupabaseClient();
  const { data, error } = await sb.from('notificaciones_envios').select('id, notificaciones_suscripciones!inner(usuario_id,sesion_id,habilitada,mostrar_detalle,sonido)')
    .eq('id', parsed.data.deliveryId).eq('notificaciones_suscripciones.usuario_id', user.id)
    .eq('notificaciones_suscripciones.sesion_id', user.sessionId).eq('notificaciones_suscripciones.habilitada', true)
    .neq('estado', 'cancelada').maybeSingle();
  if (error) return apiError('No fue posible confirmar la recepcion.', 503);
  if (!data) return apiError('Notificacion no disponible.', 404);
  const subscription = (Array.isArray(data.notificaciones_suscripciones) ? data.notificaciones_suscripciones[0] : data.notificaciones_suscripciones) as { mostrar_detalle: boolean; sonido: boolean };
  const now = new Date().toISOString();
  const patch = parsed.data.phase === 'shown' ? { mostrada_at: now, estado: 'enviada' } : { recibida_at: now };
  const { error: updateError } = await sb.from('notificaciones_envios').update(patch).eq('id', data.id);
  if (updateError) return apiError('No fue posible registrar la recepcion.', 503);
  return NextResponse.json({ authorized: true, preview: subscription.mostrar_detalle, sound: subscription.sonido }, { headers: NO_STORE_HEADERS });
}
