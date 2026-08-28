import { NextResponse } from 'next/server';

/**
 * Utilidades comunes de las rutas de API.
 *
 * Toda respuesta de error usa la misma forma para que el cliente pueda
 * mostrar un mensaje util sin adivinar el formato.
 */

export interface ApiErrorBody {
  error: string;
  detail?: string;
}

export function apiError(message: string, status: number, detail?: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message, ...(detail ? { detail } : {}) }, { status });
}

/**
 * Envuelve un handler capturando cualquier fallo del proveedor.
 *
 * Una caida del GPS o de la base externa no debe devolver un stack al
 * navegador ni tumbar la ruta: se traduce a un 503 con mensaje en espanol.
 */
export async function handleApi<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<NextResponse<T | ApiErrorBody>> {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[api] ${context}:`, detail);
    return apiError(`No fue posible obtener ${context}.`, 503, detail);
  }
}

/** Cabeceras para respuestas que nunca deben cachearse. */
export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
} as const;
