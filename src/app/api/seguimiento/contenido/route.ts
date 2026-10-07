import { NextResponse } from 'next/server';
import {
  DEFAULT_TRACKING_CONTENT,
  publicTrackingContent,
} from '@/config/tracking-content';
import { getTrackingContent } from '@/services/tracking/content-store';
export const dynamic = 'force-dynamic';

/** La publicidad nunca bloquea el mapa, ni publica campañas desactivadas. */
export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(
      publicTrackingContent(await getTrackingContent()),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error(
      '[tracking-content] No fue posible leer las campañas:',
      error instanceof Error ? error.message : 'Error de almacenamiento',
    );
    return NextResponse.json(DEFAULT_TRACKING_CONTENT, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
