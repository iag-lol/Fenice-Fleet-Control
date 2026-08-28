import 'server-only';

import { getServerEnv } from '@/config/env';
import {
  DEFAULT_OPERATIONAL_SETTINGS,
  operationalSettingsSchema,
  validateSettingsCoherence,
  type OperationalSettings,
} from '@/config/operational';

/**
 * Almacen de la configuracion operacional.
 *
 * Persistencia actual: memoria del proceso, sembrada desde variables de
 * entorno. Es lo correcto mientras no exista la base interna definitiva
 * (`DATABASE_URL`): los cambios se aplican de inmediato a todos los motores y
 * se pierden al reiniciar, lo que la UI informa explicitamente.
 *
 * Al conectar la base interna, solo cambian `load` y `persist`.
 */

const globalForSettings = globalThis as unknown as {
  __feniceSettings?: OperationalSettings;
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
    },
    geofence: {
      defaultRadiusMeters: env.DEFAULT_GEOFENCE_RADIUS_METERS,
      minDwellSeconds: env.MIN_GEOFENCE_DWELL_TIME,
      autoConfirmDeliveryOnDwell: env.AUTO_CONFIRM_DELIVERY_ON_DWELL,
    },
  };
}

/** Configuracion vigente. Fuente unica para todos los motores de reglas. */
export function getOperationalSettings(): OperationalSettings {
  if (!globalForSettings.__feniceSettings) {
    const seeded = operationalSettingsSchema.safeParse(seedFromEnv());
    globalForSettings.__feniceSettings = seeded.success ? seeded.data : DEFAULT_OPERATIONAL_SETTINGS;
  }
  return globalForSettings.__feniceSettings;
}

export interface SettingsUpdateResult {
  ok: boolean;
  settings: OperationalSettings;
  errors: string[];
}

/** Valida y aplica una nueva configuracion. */
export function updateOperationalSettings(input: unknown): SettingsUpdateResult {
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

  globalForSettings.__feniceSettings = parsed.data;
  return { ok: true, settings: parsed.data, errors: [] };
}

/** Restaura los valores provenientes del entorno. */
export function resetOperationalSettings(): OperationalSettings {
  globalForSettings.__feniceSettings = undefined;
  return getOperationalSettings();
}
