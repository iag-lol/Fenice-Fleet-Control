/**
 * Limitador de tasa en memoria, por clave (tipicamente IP + categoria de ruta).
 *
 * Vive en el mismo proceso que el servidor de Next: Render corre esta
 * aplicacion como un unico proceso Node de larga duracion (no funciones
 * serverless distribuidas), asi que un `Map` a nivel de modulo persiste
 * exactamente igual que el cache de `getServerEnv()` en `src/config/env.ts`.
 * No seria exacto si algun dia se escala a varias instancias (cada una
 * contaria por separado), pero hoy levanta la vara de verdad contra scripts,
 * fuerza bruta y scraping sin depender de infraestructura nueva (Redis u
 * otro almacen compartido) que este proyecto no tiene.
 *
 * Es intencionalmente independiente del bloqueo de login por cuenta
 * (`src/lib/login-guard.ts`, respaldado en Supabase): ese protege una cuenta
 * concreta y sobrevive a reinicios; este protege el proceso completo de
 * cualquier ruta, incluidas las publicas (`/api/seguimiento`,
 * `/api/conductor/**`) que no pasan por sesion ni por Supabase.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

/**
 * Cota de memoria ante un ataque con IPs falsificadas masivas: sin esto, un
 * atacante podria intentar agotar memoria generando una clave nueva por
 * peticion. Es un caso extremo, pero la proteccion es gratis.
 */
const MAX_TRACKED_KEYS = 20_000;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Solo para pruebas: vacia el estado entre casos. */
export function resetRateLimitState(): void {
  buckets.clear();
}
