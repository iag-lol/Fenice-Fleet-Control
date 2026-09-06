import { NextResponse } from 'next/server';

import { apiError, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import { getGpsProvider } from '@/services/registry';

export const dynamic = 'force-dynamic';

/**
 * Diagnostico de la conexion GPS.
 *
 * Existe para responder en un solo vistazo la pregunta de la puesta en
 * marcha: "¿las credenciales sirven y estan entrando posiciones?". Sin esto,
 * comprobarlo obliga a mirar el mapa y adivinar si esta vacio porque no hay
 * camiones o porque la conexion falla.
 *
 * NUNCA devuelve credenciales: solo si estan presentes y si funcionan.
 */
export async function GET(): Promise<Response> {
  const denied = await guardApi();
  if (denied) return denied;

  const env = getServerEnv();
  const gps = getGpsProvider();

  const configurado =
    env.GPS_PROVIDER === '3dtracking'
      ? Boolean(env.TRIDTRACKING_USERNAME && env.TRIDTRACKING_PASSWORD)
      : env.GPS_PROVIDER === 'traccar'
        ? Boolean(env.TRACCAR_BASE_URL)
        : true;

  try {
    const conProbe = gps as unknown as {
      healthCheck?: () => Promise<{ ok: boolean; message: string; latencyMs: number | null }>;
    };
    const salud = conProbe.healthCheck
      ? await conProbe.healthCheck()
      : { ok: true, message: 'El proveedor no expone diagnostico.', latencyMs: null };

    // Solo se consultan posiciones si la sesion funciona: pedirlas con
    // credenciales invalidas solo produce un segundo error identico.
    let vehiculos: number | null = null;
    let posiciones: number | null = null;
    let ultimaPosicionAt: string | null = null;
    let posicionesValidas: number | null = null;

    if (salud.ok) {
      const [flota, actuales] = await Promise.all([
        gps.getVehicles().catch(() => []),
        gps.getAllCurrentPositions().catch(() => []),
      ]);
      vehiculos = flota.length;
      posiciones = actuales.length;
      // Una posicion invalida es un equipo que reporta SIN fijacion satelital:
      // conviene distinguirlo de "no reporta".
      posicionesValidas = actuales.filter((p) => p.valid).length;
      ultimaPosicionAt =
        actuales.length === 0
          ? null
          : actuales.reduce((max, p) => (p.timestamp > max ? p.timestamp : max), actuales[0]!.timestamp);
    }

    const response = NextResponse.json({
      provider: gps.info.id,
      label: gps.info.label,
      simulated: gps.info.simulated,
      transport: gps.info.preferredTransport,
      /** `false` avisa de que faltan variables de entorno, no de que la red falle. */
      credencialesPresentes: configurado,
      ok: salud.ok,
      message: salud.message,
      latencyMs: salud.latencyMs,
      vehiculos,
      posiciones,
      posicionesValidas,
      ultimaPosicionAt,
      checkedAt: new Date().toISOString(),
    });
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
    return response;
  } catch (error) {
    return apiError(
      'No fue posible diagnosticar la conexion GPS.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
