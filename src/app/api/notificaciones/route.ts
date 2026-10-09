import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError, assertSameOrigin, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { resolveSessionFromCookies } from '@/lib/session';
import { readJsonBody } from '@/lib/request-body';
import { getServerEnv } from '@/config/env';
import { pushConfigured } from '@/services/notifications/push-dispatcher';
import { notificationRuntime } from '@/services/notifications/runtime-status';
import { pushPreferencesSchema, pushSubscriptionSchema } from '@/services/notifications/push-schema';
import { disablePushSubscription, savePushSubscription } from '@/services/notifications/push-store';

export const dynamic = 'force-dynamic';
export async function GET(): Promise<Response> {
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const env = getServerEnv(); const state = notificationRuntime();
  return NextResponse.json({ configured: pushConfigured(), publicKey: env.WEB_PUSH_PUBLIC_KEY ?? null,
    workerEnabled: env.ALERT_WORKER_ENABLED,
    workerRunning: state.started && !state.error && state.lastTick !== null && Date.now() - state.lastTick < 90_000,
  }, { headers: NO_STORE_HEADERS });
}
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request); if (originError) return originError;
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const user = await resolveSessionFromCookies(); if (!user) return apiError('Inicia sesion para activar notificaciones.', 401);
  if (!pushConfigured()) return apiError('Las notificaciones del sistema aun no estan disponibles.', 503);
  const parsed = z.object({ subscription: pushSubscriptionSchema, preferences: pushPreferencesSchema }).safeParse(await readJsonBody(request, 12_000));
  if (!parsed.success) return apiError('Suscripcion de notificaciones invalida.', 400);
  try {
    const id = await savePushSubscription(user, parsed.data.subscription, parsed.data.preferences);
    return NextResponse.json({ active: true, id }, { headers: NO_STORE_HEADERS });
  } catch { return apiError('No fue posible activar las notificaciones de este equipo.', 503); }
}
export async function DELETE(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request); if (originError) return originError;
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const user = await resolveSessionFromCookies(); if (!user) return apiError('Inicia sesion.', 401);
  const parsed = z.object({ endpoint: pushSubscriptionSchema.shape.endpoint }).safeParse(await readJsonBody(request, 6000));
  if (!parsed.success) return apiError('Suscripcion invalida.', 400);
  try { await disablePushSubscription(user.id, parsed.data.endpoint); return NextResponse.json({ active: false }, { headers: NO_STORE_HEADERS }); }
  catch { return apiError('No fue posible desactivar las notificaciones.', 503); }
}
