import { z } from 'zod';

/**
 * Reglas operacionales configurables desde /configuracion.
 *
 * Este modulo es ISOMORFICO: lo consume el servidor (motores de reglas) y el
 * cliente (previsualizacion en la UI). No contiene secretos.
 *
 * Regla de oro: ningun umbral vive dentro de un componente. Si un valor
 * decide un color, una alerta o un estado, pertenece aqui.
 */

export const operationalSettingsSchema = z.object({
  clients: z.object({
    /** 0..activeMaxDays  -> verde */
    activeMaxDays: z.number().int().min(1).max(365),
    /** activeMaxDays..warningMaxDays -> amarillo; mas alla -> rojo */
    warningMaxDays: z.number().int().min(2).max(1095),
    /** Considerar tambien la ultima visita, no solo la ultima compra. */
    useVisitAsActivitySignal: z.boolean(),
  }),
  gps: z.object({
    /** Segundos sin posicion para marcar la telemetria como retrasada. */
    staleSeconds: z.number().int().min(15).max(3600),
    /** Segundos sin posicion para "posible perdida de senal". */
    signalLostSeconds: z.number().int().min(30).max(7200),
    /** Segundos sin posicion para declarar el vehiculo offline. */
    offlineSeconds: z.number().int().min(60).max(86_400),
    /** Cadencia de refresco cuando se usa polling como fallback. */
    refreshIntervalMs: z.number().int().min(3000).max(120_000),
    /** km/h por debajo de los cuales se considera detenido. */
    movingSpeedThresholdKmh: z.number().min(0).max(30),
  }),
  route: z.object({
    /** Metros de tolerancia respecto al corredor planificado. */
    deviationDistanceMeters: z.number().min(25).max(5000),
    /** Segundos fuera del corredor antes de emitir alerta. */
    deviationTimeSeconds: z.number().min(10).max(3600),
    /** Segundos fuera de comuna autorizada antes de emitir alerta. */
    outOfCommuneToleranceSeconds: z.number().min(30).max(7200),
    /** Segundos detenido fuera de una geocerca para alertar. */
    prolongedStopSeconds: z.number().min(60).max(14_400),
  }),
  geofence: z.object({
    /** Radio por defecto de la geocerca generada por direccion de despacho. */
    defaultRadiusMeters: z.number().min(20).max(2000),
    /** Permanencia minima dentro de la geocerca para validar la visita. */
    minDwellSeconds: z.number().min(0).max(3600),
    /** Convertir automaticamente una visita confirmada en entrega detectada. */
    autoConfirmDeliveryOnDwell: z.boolean(),
  }),
});

export type OperationalSettings = z.infer<typeof operationalSettingsSchema>;

export const DEFAULT_OPERATIONAL_SETTINGS: OperationalSettings = {
  clients: {
    activeMaxDays: 21,
    warningMaxDays: 60,
    useVisitAsActivitySignal: false,
  },
  gps: {
    staleSeconds: 60,
    signalLostSeconds: 180,
    offlineSeconds: 600,
    refreshIntervalMs: 15_000,
    movingSpeedThresholdKmh: 3,
  },
  route: {
    deviationDistanceMeters: 300,
    deviationTimeSeconds: 120,
    outOfCommuneToleranceSeconds: 300,
    prolongedStopSeconds: 900,
  },
  geofence: {
    defaultRadiusMeters: 80,
    minDwellSeconds: 60,
    autoConfirmDeliveryOnDwell: true,
  },
};

/** Radios ofrecidos en la UI al configurar la geocerca de una entrega. */
export const GEOFENCE_RADIUS_PRESETS = [50, 80, 100, 150] as const;

/**
 * Valida que los umbrales sean internamente coherentes.
 * Devuelve mensajes en espanol listos para mostrar en el formulario.
 */
export function validateSettingsCoherence(settings: OperationalSettings): string[] {
  const errors: string[] = [];

  if (settings.clients.warningMaxDays <= settings.clients.activeMaxDays) {
    errors.push(
      'El umbral de cliente en observacion debe ser mayor que el de cliente activo.',
    );
  }
  if (settings.gps.signalLostSeconds <= settings.gps.staleSeconds) {
    errors.push('El umbral de perdida de senal debe superar al de advertencia.');
  }
  if (settings.gps.offlineSeconds <= settings.gps.signalLostSeconds) {
    errors.push('El umbral de vehiculo offline debe superar al de perdida de senal.');
  }
  return errors;
}
