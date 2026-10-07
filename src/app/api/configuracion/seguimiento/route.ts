import { NextResponse } from 'next/server';
import { apiError, assertSameOrigin, guardApi } from '@/lib/api';
import { trackingContentSchema } from '@/config/tracking-content';
import {
  getTrackingContent,
  saveTrackingContent,
} from '@/services/tracking/content-store';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi('configuracion.editar');
  if (denied) return denied;
  try {
    return NextResponse.json(await getTrackingContent(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return apiError(
      'No pudimos cargar la publicidad. Reintenta antes de guardar.',
      503,
    );
  }
}
export async function PUT(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const denied = await guardApi('configuracion.editar');
  if (denied) return denied;
  const parsed = trackingContentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return apiError(
      parsed.error.issues.map((issue) => issue.message).join(' '),
      400,
    );
  try {
    return NextResponse.json(await saveTrackingContent(parsed.data));
  } catch {
    return apiError(
      'No se guardaron los cambios. Revisa la conexión al almacenamiento y vuelve a intentar.',
      503,
    );
  }
}
