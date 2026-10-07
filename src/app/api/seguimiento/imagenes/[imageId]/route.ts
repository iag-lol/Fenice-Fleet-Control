import { apiError } from '@/lib/api';
import {
  TRACKING_IMAGE_ID,
  trackingImageType,
} from '@/config/tracking-content';
import { getTrackingImage } from '@/services/tracking/content-store';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ imageId: string }> },
): Promise<Response> {
  const { imageId } = await params;
  if (!TRACKING_IMAGE_ID.test(imageId))
    return apiError('Imagen no encontrada.', 404);
  try {
    const bytes = await getTrackingImage(imageId);
    const type = bytes ? trackingImageType(bytes) : null;
    if (!bytes || !type) return apiError('Imagen no encontrada.', 404);
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': type.mime,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return apiError('Imagen temporalmente no disponible.', 503);
  }
}
