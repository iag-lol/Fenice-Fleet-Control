import { z } from 'zod';

/**
 * Configuracion de servidor. NUNCA importar este modulo desde un componente
 * cliente: contiene credenciales de Traccar y de la base externa de Fenice.
 *
 * Todo lo que el navegador necesita saber viaja por `publicRuntimeConfig`
 * (abajo) o por respuestas de API ya sanitizadas.
 */

const booleanFromEnv = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const serverEnvSchema = z.object({
  AUTH_ENABLED: booleanFromEnv.default('false'),

  /**
   * Fuente de telemetria.
   *
   * Por defecto `3dtracking`, que es el proveedor contratado. Sin credenciales
   * la plataforma no muestra nada y explica que faltan, en vez de anunciar un
   * modo demostracion que ya no sirve datos: decir "DEMO" cuando no hay ni
   * datos falsos ni reales solo confunde a quien mira la pantalla.
   */
  GPS_PROVIDER: z.enum(['mock', 'traccar', '3dtracking']).default('3dtracking'),
  OPERATIONS_PROVIDER: z.enum(['mock', 'external']).default('mock'),
  GEOCODING_PROVIDER: z.enum(['none', 'nominatim', 'maptiler', 'mapbox', 'google']).default('none'),
  ROUTING_PROVIDER: z.enum(['estimated', 'osrm', 'mapbox', 'google', 'maptiler']).default('estimated'),

  // --- Traccar (integracion GPS real: Teltonika FMC130 -> SIM 4G -> Traccar) ---
  TRACCAR_BASE_URL: z.string().url().optional(),
  TRACCAR_USERNAME: z.string().optional(),
  TRACCAR_PASSWORD: z.string().optional(),
  TRACCAR_TOKEN: z.string().optional(),
  TRACCAR_WEBSOCKET_URL: z.string().optional(),

  // --- 3DTracking (Client WebApi v1.0) ---
  // La API pide usuario y clave y devuelve UserIdGuid + SessionId, que viajan
  // como parametros de consulta en cada llamada. Por eso NADA de esto puede
  // llegar al navegador: solo se lee desde el servidor.
  // Documentacion: https://apiv2.3dtracking.net/docs/v1/
  TRIDTRACKING_BASE_URL: z.string().url().default('https://apiv2.3dtracking.net'),
  TRIDTRACKING_USERNAME: z.string().optional(),
  TRIDTRACKING_PASSWORD: z.string().optional(),
  TRIDTRACKING_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(15_000),

  // --- Base de datos externa de Fenice (SOLO LECTURA) ---
  EXTERNAL_DB_ENGINE: z.enum(['postgres', 'mysql', 'sqlserver', 'oracle']).optional(),
  EXTERNAL_DB_HOST: z.string().optional(),
  EXTERNAL_DB_PORT: z.coerce.number().int().positive().optional(),
  EXTERNAL_DB_NAME: z.string().optional(),
  EXTERNAL_DB_USER: z.string().optional(),
  EXTERNAL_DB_PASSWORD: z.string().optional(),
  EXTERNAL_DB_SCHEMA: z.string().optional(),
  EXTERNAL_DB_SSL: booleanFromEnv.default('true'),

  // --- Base de datos interna de la plataforma ---
  DATABASE_URL: z.string().optional(),

  // --- Trafico en tiempo real ---
  TRAFFIC_PROVIDER: z.enum(['none', 'mapbox', 'tomtom', 'google']).default('none'),
  TRAFFIC_API_KEY: z.string().optional(),
  /**
   * Cuota mensual del proveedor. El nivel gratuito de TomTom son 200.000
   * consultas; el sistema reparte esa cifra dentro de la jornada de despacho
   * en vez de gastarla de madrugada.
   */
  TRAFFIC_MONTHLY_QUOTA: z.coerce.number().int().positive().default(200_000),
  /**
   * Tamano previsto de la flota, para dimensionar el gasto de trafico.
   *
   * El sistema cuenta los camiones que estan reportando, pero ese numero es 0
   * antes de conectar el GPS y baja de madrugada. Dimensionar con el valor
   * real en esos momentos daria un intervalo demasiado corto y el gasto se
   * dispararia al volver la flota. Se usa el MAYOR de los dos: quedarse
   * corto de frecuencia solo envejece un poco el dato; pasarse de cuota deja
   * a la operacion sin trafico.
   */
  TRAFFIC_EXPECTED_FLEET: z.coerce.number().int().positive().max(2000).default(10),
  /** Jornada de despacho: fuera de ella no se consulta trafico. */
  TRAFFIC_WINDOW_START_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  TRAFFIC_WINDOW_END_HOUR: z.coerce.number().int().min(1).max(24).default(19),
  /** Dias activos: 1 = lunes ... 7 = domingo. */
  TRAFFIC_WINDOW_WEEKDAYS: z
    .string()
    .default('1,2,3,4,5')
    .transform((v) =>
      v
        .split(',')
        .map((d) => Number(d.trim()))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
    ),

  // --- Proveedores de mapa / routing ---
  MAPTILER_API_KEY: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  OSRM_BASE_URL: z.string().url().optional(),

  // --- Reglas operacionales (sobreescribibles por la UI de configuracion) ---
  CLIENT_ACTIVE_MAX_DAYS: z.coerce.number().int().positive().default(21),
  CLIENT_WARNING_MAX_DAYS: z.coerce.number().int().positive().default(60),

  GPS_STALE_SECONDS: z.coerce.number().int().positive().default(60),
  GPS_SIGNAL_LOST_SECONDS: z.coerce.number().int().positive().default(180),
  GPS_OFFLINE_SECONDS: z.coerce.number().int().positive().default(600),
  GPS_REFRESH_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  /**
   * Transporte de las posiciones en vivo hacia el navegador.
   *
   *  - `sse`     streaming continuo. Es el mejor en un servidor propio.
   *  - `polling` consultas periodicas a /api/gps/positions.
   *  - `auto`    SSE, degradando solo si el navegador no lo soporta.
   *
   * En plataformas sin servidor (Vercel, Netlify, Cloudflare) las funciones
   * tienen un tiempo maximo de ejecucion, asi que un stream se corta cada
   * pocos segundos y el navegador reconecta sin parar. Ahi `polling` da una
   * experiencia mejor y mas barata, y por eso esto se configura y no se
   * adivina en tiempo de ejecucion.
   */
  GPS_LIVE_TRANSPORT: z.enum(['auto', 'sse', 'polling']).default('auto'),
  /**
   * Vida maxima de un stream SSE, en segundos.
   *
   * Debe quedar POR DEBAJO del limite de la plataforma para que el servidor
   * cierre limpiamente en vez de que lo maten a mitad de un evento.
   */
  GPS_STREAM_MAX_SECONDS: z.coerce.number().int().positive().max(3600).default(1800),

  ROUTE_DEVIATION_DISTANCE: z.coerce.number().positive().default(300),
  ROUTE_DEVIATION_TIME: z.coerce.number().positive().default(120),
  OUT_OF_COMMUNE_TOLERANCE_SECONDS: z.coerce.number().positive().default(300),
  PROLONGED_STOP_SECONDS: z.coerce.number().positive().default(900),

  DEFAULT_GEOFENCE_RADIUS_METERS: z.coerce.number().positive().default(80),
  MIN_GEOFENCE_DWELL_TIME: z.coerce.number().nonnegative().default(60),
  AUTO_CONFIRM_DELIVERY_ON_DWELL: booleanFromEnv.default('true'),
  DELIVERY_DETECTION_MODE: z.enum(['enter', 'dwell', 'driver', 'hybrid']).default('hybrid'),

  // --- Portal del conductor (Plan Medio) ---
  /**
   * Clave con la que se firman los enlaces de ruta del conductor.
   *
   * Si no se define, el proceso genera una aleatoria al arrancar: los enlaces
   * dejan de ser validos en cada reinicio. Eso es aceptable en demostracion y
   * deliberadamente molesto en produccion, donde debe definirse de verdad.
   */
  DRIVER_PORTAL_SECRET: z.string().min(16).optional(),
  /** Vigencia del enlace. Una jornada mas margen, no un enlace eterno. */
  DRIVER_TOKEN_TTL_HOURS: z.coerce.number().int().positive().max(168).default(16),
  /** Tope por fotografia ya comprimida en el telefono, en bytes. */
  PROOF_PHOTO_MAX_BYTES: z.coerce.number().int().positive().default(900_000),
  PROOF_MAX_PHOTOS: z.coerce.number().int().positive().max(10).default(4),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/** Lee y valida el entorno de servidor una sola vez por proceso. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Configuracion de entorno invalida en Fenice Fleet Control:\n${issues}\n` +
        'Revisa tu archivo .env.local contra .env.example.',
    );
  }

  cached = parsed.data;
  return cached;
}
