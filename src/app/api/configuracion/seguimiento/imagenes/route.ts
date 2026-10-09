import { NextResponse } from 'next/server';
import { readBoundedBody } from '@/lib/request-body';
import { apiError, assertSameOrigin, guardApi } from '@/lib/api';
import {
  MAX_TRACKING_IMAGE_BYTES,
  trackingImageType,
} from '@/config/tracking-content';
import { saveTrackingImage } from '@/services/tracking/content-store';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  const denied = await guardApi('configuracion.editar');
  if (denied) return denied;
  if (
    Number(request.headers.get('content-length')) >
    MAX_TRACKING_IMAGE_BYTES + 16384
  )
    return apiError('La imagen debe pesar hasta 2 MB.', 413);
  const bytesBody = await readBoundedBody(request, MAX_TRACKING_IMAGE_BYTES + 16384);
  if (!bytesBody) return apiError('La imagen debe pesar hasta 2 MB.', 413);
  const bounded = new Request(request.url, { method: 'POST', headers: request.headers, body: bytesBody as BodyInit });
  const form = await bounded.formData().catch(() => null);
  const file = form?.get('image');
  if (!(file instanceof File) || file.size > MAX_TRACKING_IMAGE_BYTES)
    return apiError('Selecciona una imagen de hasta 2 MB.', 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!trackingImageType(bytes))
    return apiError('Formato no válido. Usa JPG, PNG o WebP.', 400);
  try {
    return NextResponse.json(
      { imageUrl: await saveTrackingImage(bytes) },
      { status: 201 },
    );
  } catch {
    return apiError(
      'No pudimos subir la imagen. Revisa la conexión al almacenamiento.',
      503,
    );
  }
}
