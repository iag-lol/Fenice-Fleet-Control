import { z } from 'zod';

export function isTrustedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && (!url.port || url.port === '443') &&
      !url.username && !url.password && !url.hash &&
      (url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' ||
       url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(4096).refine(isTrustedPushEndpoint),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/),
  }),
});
export const pushPreferencesSchema = z.object({
  sound: z.boolean().default(true),
  preview: z.boolean().default(false),
  minSeverity: z.enum(['info', 'warning', 'critical']).default('info'),
});
