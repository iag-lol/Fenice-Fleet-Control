import { NextResponse } from 'next/server';

import { NO_STORE_HEADERS } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';

export const dynamic = 'force-dynamic';

/**
 * Lee el `role` declarado en el payload de la API key de Supabase cuando es
 * un JWT (formato legado: `anon`/`service_role`), sin verificar su firma —
 * no hace falta, solo se quiere saber que TIPO de clave llego por variable
 * de entorno. Los proyectos nuevos de Supabase usan claves opacas
 * (`sb_secret_...`), que no son JWT: en ese caso se devuelve `null` y el
 * diagnostico se apoya solo en la prueba de conexion real.
 *
 * Es la forma mas directa de detectar el error de configuracion mas comun —
 * pegar la clave `anon` en `SUPABASE_SERVICE_ROLE_KEY` — sin depender de que
 * una consulta de prueba lo delate indirectamente: una consulta SELECT bajo
 * Row Level Security con la clave equivocada no falla, solo devuelve cero
 * filas, lo que parece "conexion correcta, tabla vacia" aunque la tabla
 * tenga datos.
 */
function decodeLegacyKeyRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null; // no es un JWT (clave nueva formato sb_secret_...)

  try {
    const json = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Diagnostico de la conexion a Supabase.
 *
 * Deliberadamente PUBLICO (sin `guardApi`): es lo primero que hay que revisar
 * cuando el login no funciona, y en ese momento el login mismo (que si exige
 * sesion) todavia no sirve para nada — pedirle sesion a este endpoint seria
 * un candado sin llave. No expone `SUPABASE_URL` ni la clave completa: solo
 * si estan presentes, que rol declara la clave (cuando se puede saber), si
 * la conexion funciona, y el mensaje de error de Supabase cuando no (ninguno
 * de estos filtra secretos, igual que `/api/system/gps`).
 */
export async function GET(): Promise<Response> {
  const env = getServerEnv();
  const configured = isSupabaseConfigured();

  const result: {
    configured: boolean;
    authEnabled: boolean;
    keyRole: string | null;
    connected: boolean;
    usuariosCount: number | null;
    message: string;
  } = {
    configured,
    authEnabled: env.AUTH_ENABLED,
    keyRole: null,
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

  result.keyRole = decodeLegacyKeyRole(env.SUPABASE_SERVICE_ROLE_KEY!);
  const wrongLegacyKey = result.keyRole !== null && result.keyRole !== 'service_role';

  try {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase.from('usuarios').select('id', { count: 'exact', head: true });

    if (error) {
      result.message = `Supabase respondio con un error al consultar "usuarios": ${error.message}`;
    } else {
      result.connected = true;
      result.usuariosCount = count ?? 0;

      if (wrongLegacyKey) {
        // La consulta "funciono" pero Row Level Security, sin politicas
        // permisivas, filtra en silencio todas las filas para cualquier rol
        // que no sea `service_role`: por eso la tabla puede parecer vacia
        // aunque tenga datos.
        result.message =
          `SUPABASE_SERVICE_ROLE_KEY tiene el rol "${result.keyRole}", no "service_role". ` +
          'En Supabase (Settings -> API) es la clave marcada "service_role" (secreta), no la "anon public". ' +
          `Con la clave equivocada, la app solo ve ${count ?? 0} de las filas reales (Row Level Security las oculta) ` +
          'y las escrituras (crear geocercas, vehiculos, etc.) fallan con un error de Row Level Security.';
      } else {
        result.message =
          count && count > 0
            ? `Conexion correcta. La tabla "usuarios" tiene ${count} registro(s).`
            : 'Conexion correcta, pero la tabla "usuarios" esta vacia. Crea el primer administrador con `npm run create:admin` (o el SQL equivalente).';
      }
    }
  } catch (error) {
    result.message = `No fue posible conectar con Supabase: ${error instanceof Error ? error.message : String(error)}`;
  }

  const response = NextResponse.json(result, { status: result.connected && !wrongLegacyKey ? 200 : 503 });
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
