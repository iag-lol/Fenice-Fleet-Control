import { readJsonBody } from '@/lib/request-body';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { getGpsProvider } from '@/services/registry';
import { getOperationalSettings } from '@/services/settings/settings-store';
import { checkTridReadiness } from '@/services/gps/tridtracking/tridtracking-readiness';

export const dynamic = 'force-dynamic';
const schema = z.object({ plate: z.string().trim().min(5).max(10),
  imei: z.string().regex(/^\d{15}$/).optional().or(z.literal('')), history: z.boolean().optional() });
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request); if (originError) return originError;
  const denied = await guardApi('flota.ver'); if (denied) return denied;
  const parsed = schema.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: 'Ingresa una patente valida y, si lo tienes, el IMEI de 15 digitos.' }, { status: 400 });
  const report = await checkTridReadiness(getGpsProvider(), { ...parsed.data,
    imei: parsed.data.imei || undefined, maxAgeSeconds: getOperationalSettings().gps.staleSeconds });
  return NextResponse.json(report, { headers: NO_STORE_HEADERS });
}
