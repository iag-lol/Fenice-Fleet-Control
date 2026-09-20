import 'server-only';

import { getServerEnv } from '@/config/env';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  operationalSettingsSchema,
  validateSettingsCoherence,
  type OperationalSettings,
} from '@/config/operational';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';

/**
 * Almacen de la configuracion operacional.
 *
 * `getOperationalSettings()` es SINCRONA a proposito: la consultan motores de
 * reglas y agregadores en decenas de puntos, muchos de ellos fuera de un
 * contexto async. Hacerla asincrona obligaria a propagar `await` por toda esa
 * cadena para leer un valor que casi nunca cambia.
 *
 * En su lugar se usa un cache en memoria como fuente de lectura inmediata, con
 * una carga diferida (no bloqueante) desde Supabase cuando esta configurado.
 * Las escrituras (`updateOperationalSettings`, `resetOperationalSettings`) SI
 * son asincronas: son infrecuentes (las hace un administrador desde
 * `/configuracion`) y necesitan confirmar que quedaron guardadas.
 *
 * Sin Supabase configurado (`FLEET_DATA_PROVIDER=memory`), el comportamiento
 * es identico al original: todo vive en memoria del proceso, sembrado desde
 * variables de entorno.
 */

const SETTINGS_TABLE = 'configuracion_operacional';

const globalForSettings = globalThis as unknown as {
  __feniceSettings?: OperationalSettings;
  __feniceSettingsSupabaseLoadStarted?: boolean;
};

function seedFromEnv(): OperationalSettings {
  const env = getServerEnv();

  return {
    clients: {
      activeMaxDays: env.CLIENT_ACTIVE_MAX_DAYS,
      warningMaxDays: env.CLIENT_WARNING_MAX_DAYS,
      useVisitAsActivitySignal: DEFAULT_OPERATIONAL_SETTINGS.clients.useVisitAsActivitySignal,
    },
    gps: {
      staleSeconds: env.GPS_STALE_SECONDS,
      signalLostSeconds: env.GPS_SIGNAL_LOST_SECONDS,
      offlineSeconds: env.GPS_OFFLINE_SECONDS,
      refreshIntervalMs: env.GPS_REFRESH_INTERVAL_MS,
      movingSpeedThresholdKmh: DEFAULT_OPERATIONAL_SETTINGS.gps.movingSpeedThresholdKmh,
    },
    route: {
      deviationDistanceMeters: env.ROUTE_DEVIATION_DISTANCE,
      deviationTimeSeconds: env.ROUTE_DEVIATION_TIME,
      outOfCommuneToleranceSeconds: env.OUT_OF_COMMUNE_TOLERANCE_SECONDS,
      prolongedStopSeconds: env.PROLONGED_STOP_SECONDS,
      maxLegalSpeedKmh: DEFAULT_OPERATIONAL_SETTINGS.route.maxLegalSpeedKmh,
    },
    geofence: {
      defaultRadiusMeters: env.DEFAULT_GEOFENCE_RADIUS_METERS,
      minDwellSeconds: env.MIN_GEOFENCE_DWELL_TIME,
      autoConfirmDeliveryOnDwell: env.AUTO_CONFIRM_DELIVERY_ON_DWELL,
    },
  };
}

interface SettingsRow {
  clientes_dias_activo: number;
  clientes_dias_advertencia: number;
  clientes_usar_visita_como_actividad: boolean;
  gps_segundos_retraso: number;
  gps_segundos_posible_perdida: number;
  gps_segundos_offline: number;
  gps_intervalo_refresco_ms: number;
  gps_umbral_movimiento_kmh: number;
  ruta_desvio_metros: number;
  ruta_desvio_segundos: number;
  ruta_tolerancia_fuera_comuna_segundos: number;
  ruta_detencion_prolongada_segundos: number;
  ruta_velocidad_maxima_legal_kmh: number | null;
  geocerca_radio_defecto_metros: number;
  geocerca_permanencia_min_segundos: number;
  geocerca_auto_confirmar_entrega: boolean;
}

function rowToSettings(row: SettingsRow): OperationalSettings {
  return {
    clients: {
      activeMaxDays: row.clientes_dias_activo,
      warningMaxDays: row.clientes_dias_advertencia,
      useVisitAsActivitySignal: row.clientes_usar_visita_como_actividad,
    },
    gps: {
      staleSeconds: row.gps_segundos_retraso,
      signalLostSeconds: row.gps_segundos_posible_perdida,
      offlineSeconds: row.gps_segundos_offline,
      refreshIntervalMs: row.gps_intervalo_refresco_ms,
      movingSpeedThresholdKmh: row.gps_umbral_movimiento_kmh,
    },
    route: {
      deviationDistanceMeters: row.ruta_desvio_metros,
      deviationTimeSeconds: row.ruta_desvio_segundos,
      outOfCommuneToleranceSeconds: row.ruta_tolerancia_fuera_comuna_segundos,
      prolongedStopSeconds: row.ruta_detencion_prolongada_segundos,
      // Columna agregada despues: una fila sembrada por una version anterior
      // de la plataforma no la tiene todavia.
      maxLegalSpeedKmh: row.ruta_velocidad_maxima_legal_kmh ?? DEFAULT_OPERATIONAL_SETTINGS.route.maxLegalSpeedKmh,
    },
    geofence: {
      defaultRadiusMeters: row.geocerca_radio_defecto_metros,
      minDwellSeconds: row.geocerca_permanencia_min_segundos,
      autoConfirmDeliveryOnDwell: row.geocerca_auto_confirmar_entrega,
    },
  };
}

function settingsToRow(settings: OperationalSettings): SettingsRow {
  return {
    clientes_dias_activo: settings.clients.activeMaxDays,
    clientes_dias_advertencia: settings.clients.warningMaxDays,
    clientes_usar_visita_como_actividad: settings.clients.useVisitAsActivitySignal,
    gps_segundos_retraso: settings.gps.staleSeconds,
    gps_segundos_posible_perdida: settings.gps.signalLostSeconds,
    gps_segundos_offline: settings.gps.offlineSeconds,
    gps_intervalo_refresco_ms: settings.gps.refreshIntervalMs,
    gps_umbral_movimiento_kmh: settings.gps.movingSpeedThresholdKmh,
    ruta_desvio_metros: settings.route.deviationDistanceMeters,
    ruta_desvio_segundos: settings.route.deviationTimeSeconds,
    ruta_tolerancia_fuera_comuna_segundos: settings.route.outOfCommuneToleranceSeconds,
    ruta_detencion_prolongada_segundos: settings.route.prolongedStopSeconds,
    ruta_velocidad_maxima_legal_kmh: settings.route.maxLegalSpeedKmh,
    geocerca_radio_defecto_metros: settings.geofence.defaultRadiusMeters,
    geocerca_permanencia_min_segundos: settings.geofence.minDwellSeconds,
    geocerca_auto_confirmar_entrega: settings.geofence.autoConfirmDeliveryOnDwell,
  };
}

function currentSettings(): OperationalSettings {
  if (!globalForSettings.__feniceSettings) {
    const seeded = operationalSettingsSchema.safeParse(seedFromEnv());
    globalForSettings.__feniceSettings = seeded.success ? seeded.data : DEFAULT_OPERATIONAL_SETTINGS;
  }
  return globalForSettings.__feniceSettings;
}

/**
 * Dispara, como maximo una vez por proceso, la carga desde Supabase.
 *
 * No bloquea: mientras la carga esta en vuelo, las lecturas devuelven el
 * valor sembrado desde el entorno. Es un compromiso deliberado: preferible a
 * que la primera peticion del proceso espere una consulta de red por un dato
 * que cambia con muy poca frecuencia.
 */
function ensureLoadedFromSupabase(): void {
  if (!isSupabaseConfigured() || globalForSettings.__feniceSettingsSupabaseLoadStarted) return;
  globalForSettings.__feniceSettingsSupabaseLoadStarted = true;

  void getSupabaseClient()
    .from(SETTINGS_TABLE)
    .select('*')
    .eq('id', true)
    .maybeSingle<SettingsRow>()
    .then(({ data, error }) => {
      if (error) {
        console.error('[settings-store] no fue posible cargar la configuracion:', error.message);
        return;
      }
      if (!data) {
        // Primera vez que arranca contra esta base: siembra la fila con lo
        // que ya esta en memoria (entorno), para que quede algo que editar.
        void getSupabaseClient()
          .from(SETTINGS_TABLE)
          .insert({ id: true, ...settingsToRow(currentSettings()) })
          .then(({ error: insertError }) => {
            if (insertError) {
              console.error('[settings-store] no fue posible sembrar la configuracion:', insertError.message);
            }
          });
        return;
      }

      const parsed = operationalSettingsSchema.safeParse(rowToSettings(data));
      if (parsed.success) globalForSettings.__feniceSettings = parsed.data;
    });
}

/** Configuracion vigente. Fuente unica para todos los motores de reglas. */
export function getOperationalSettings(): OperationalSettings {
  ensureLoadedFromSupabase();
  return currentSettings();
}

export interface SettingsUpdateResult {
  ok: boolean;
  settings: OperationalSettings;
  errors: string[];
}

/** Valida y aplica una nueva configuracion. */
export async function updateOperationalSettings(input: unknown): Promise<SettingsUpdateResult> {
  const parsed = operationalSettingsSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      settings: getOperationalSettings(),
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    };
  }

  const coherenceErrors = validateSettingsCoherence(parsed.data);
  if (coherenceErrors.length > 0) {
    return { ok: false, settings: getOperationalSettings(), errors: coherenceErrors };
  }

  // Se aplica de inmediato en memoria: los motores no esperan a Supabase para
  // ver el cambio, aunque la escritura remota falle (se registra el error,
  // pero no se revierte: el operador ya vio el cambio surtir efecto).
  globalForSettings.__feniceSettings = parsed.data;

  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient()
      .from(SETTINGS_TABLE)
      .upsert({ id: true, ...settingsToRow(parsed.data) }, { onConflict: 'id' });
    if (error) console.error('[settings-store] no fue posible guardar la configuracion:', error.message);
  }

  return { ok: true, settings: parsed.data, errors: [] };
}

/** Restaura los valores provenientes del entorno. */
export async function resetOperationalSettings(): Promise<OperationalSettings> {
  globalForSettings.__feniceSettings = undefined;
  const restored = currentSettings();

  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient()
      .from(SETTINGS_TABLE)
      .upsert({ id: true, ...settingsToRow(restored) }, { onConflict: 'id' });
    if (error) console.error('[settings-store] no fue posible restaurar la configuracion:', error.message);
  }

  return restored;
}
