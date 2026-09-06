import { NextResponse } from 'next/server';

import { NO_STORE_HEADERS } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';

export const dynamic = 'force-dynamic';

/**
 * Diagnostico de la conexion a Supabase.
 *
 * Deliberadamente PUBLICO (sin `guardApi`): es lo primero que hay que revisar
 * cuando el login no funciona, y en ese momento el login mismo (que si exige
 * sesion) todavia no sirve para nada — pedirle sesion a este endpoint seria
 * un candado sin llave. No expone `SUPABASE_URL` ni la service role key:
 * solo si estan presentes, si la conexion funciona, y el mensaje de error de
 * Supabase cuando no (ninguno de los dos filtra secretos, igual que
 * `/api/system/gps`).
 */
export async function GET(): Promise<Response> {
  const env = getServerEnv();
  const configured = isSupabaseConfigured();

  const result: {
    configured: boolean;
    authEnabled: boolean;
    connected: boolean;
    usuariosCount: number | null;
    message: string;
  } = {
    configured,
    authEnabled: env.AUTH_ENABLED,
    connected: false,
    usuariosCount: null,
    message: '',
  };

  if (!configured) {
    result.message =
      'Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY. Configuralas en las variables de entorno del servidor.';
    const response = NextResponse.json(result, { status: 503 });
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
    return response;
  }

  try {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase.from('usuarios').select('id', { count: 'exact', head: true });

    if (error) {
      result.message = `Supabase respondio con un error al consultar "usuarios": ${error.message}`;
    } else {
      result.connected = true;
      result.usuariosCount = count ?? 0;
      result.message =
        count && count > 0
          ? `Conexion correcta. La tabla "usuarios" tiene ${count} registro(s).`
          : 'Conexion correcta, pero la tabla "usuarios" esta vacia. Crea el primer administrador con `npm run create:admin` (o el SQL equivalente).';
    }
  } catch (error) {
    result.message = `No fue posible conectar con Supabase: ${error instanceof Error ? error.message : String(error)}`;
  }

  const response = NextResponse.json(result, { status: result.connected ? 200 : 503 });
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
