import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getServerEnv } from '@/config/env';

/**
 * Cliente de Supabase, exclusivamente de servidor.
 *
 * Se conecta con la *service role key*, que se salta Row Level Security por
 * diseño de Supabase: es el equivalente a un superusuario de Postgres. Por
 * eso esta clave NUNCA debe llegar al navegador (no lleva prefijo
 * `NEXT_PUBLIC_`, y este modulo importa `server-only` para que un import
 * accidental desde un componente cliente falle en tiempo de build).
 *
 * Esta plataforma NO usa Supabase Auth: el login propio (RUT + contrasena)
 * vive en las tablas `usuarios`/`sesiones` y se valida con el codigo de
 * `src/lib/session.ts` y `src/lib/password.ts`. Por eso se desactiva aqui
 * explicitamente todo lo relacionado con la gestion de sesion de Supabase
 * (`persistSession`, `autoRefreshToken`): este cliente es solo una via de
 * acceso a Postgres, no un sistema de autenticacion.
 */

const globalForSupabase = globalThis as unknown as {
  __feniceSupabase?: SupabaseClient;
};

export function isSupabaseConfigured(): boolean {
  const env = getServerEnv();
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Cliente de Supabase. Lanza si no hay credenciales: preferible un error
 * explicito a una conexion silenciosamente rota, igual que el resto de
 * proveedores de esta plataforma (Traccar, 3DTracking, base de Fenice).
 */
export function getSupabaseClient(): SupabaseClient {
  if (globalForSupabase.__feniceSupabase) return globalForSupabase.__feniceSupabase;

  const env = getServerEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      'Supabase no esta configurado: faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. ' +
        'Consulta docs/SUPABASE-INTEGRATION.md.',
    );
  }

  globalForSupabase.__feniceSupabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: 'public' },
  });

  return globalForSupabase.__feniceSupabase;
}
