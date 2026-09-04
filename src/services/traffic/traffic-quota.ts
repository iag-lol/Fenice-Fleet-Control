/**
 * Reparto de la cuota mensual de trafico dentro de la jornada real.
 *
 * El nivel gratuito de TomTom da 200.000 consultas al mes. Repartirlas entre
 * los 43.200 minutos del mes seria tirar la mayor parte a la basura: de noche
 * y en fin de semana no hay camiones en ruta y no hay nada que consultar.
 *
 * Concentrandolas en la jornada de despacho (lunes a viernes, 08:00 a 19:00)
 * queda mas del triple de presupuesto por minuto util. Este modulo hace ese
 * calculo y es puro, de modo que el intervalo se puede verificar sin gastar
 * ni una llamada real.
 */

export interface OperatingWindow {
  /** Hora de inicio en horario local, 0-23. */
  startHour: number;
  /** Hora de termino en horario local, 0-23. No incluida. */
  endHour: number;
  /** Dias activos: 1 = lunes ... 7 = domingo. */
  weekdays: number[];
}

export const DEFAULT_WINDOW: OperatingWindow = {
  startHour: 8,
  endHour: 19,
  weekdays: [1, 2, 3, 4, 5],
};

/**
 * Margen que NO se reparte.
 *
 * Cubre los reintentos, las pruebas de puesta en marcha y los meses con 23
 * dias habiles en lugar de 21. Agotar la cuota a mitad de mes dejaria la
 * operacion sin trafico justo cuando mas se usa.
 */
const DEFAULT_HEADROOM = 0.15;

/**
 * Dias habiles del peor mes posible.
 *
 * Se calcula sobre 23 y no sobre el promedio de 21,7: dimensionar con el
 * promedio significa pasarse en los meses largos, que es exactamente cuando
 * no se puede fallar.
 */
const WORST_CASE_ACTIVE_DAYS = 23;

/** `true` si el instante cae dentro de la jornada de despacho. */
export function isWithinWindow(date: Date, window: OperatingWindow = DEFAULT_WINDOW): boolean {
  // getDay(): 0 = domingo. Se normaliza a 1-7 con lunes = 1.
  const weekday = date.getDay() === 0 ? 7 : date.getDay();
  if (!window.weekdays.includes(weekday)) return false;

  const hour = date.getHours();
  return hour >= window.startHour && hour < window.endHour;
}

/** Minutos utiles del mes segun la ventana declarada. */
export function operatingMinutesPerMonth(window: OperatingWindow = DEFAULT_WINDOW): number {
  const hoursPerDay = Math.max(0, window.endHour - window.startHour);
  const activeDaysPerWeek = window.weekdays.length;
  if (hoursPerDay === 0 || activeDaysPerWeek === 0) return 0;

  const activeDays = Math.round((WORST_CASE_ACTIVE_DAYS * activeDaysPerWeek) / 5);
  return hoursPerDay * 60 * activeDays;
}

/** Consultas por minuto que la cuota permite dentro de la ventana. */
export function requestsPerMinute(
  monthlyQuota: number,
  window: OperatingWindow = DEFAULT_WINDOW,
  headroom = DEFAULT_HEADROOM,
): number {
  const minutes = operatingMinutesPerMonth(window);
  if (minutes === 0 || monthlyQuota <= 0) return 0;
  return (monthlyQuota * (1 - headroom)) / minutes;
}

export interface QuotaPlan {
  /** Segundos entre consultas para no superar la cuota. */
  intervalSeconds: number;
  /** Consultas estimadas al mes con ese intervalo. */
  monthlyRequests: number;
  /** Proporcion de la cuota que se usaria (0-1). */
  quotaUsage: number;
  minutesPerMonth: number;
}

/**
 * Intervalo seguro de consulta para una flota dada.
 *
 * Nuestra implementacion consulta la congestion del tramo donde esta CADA
 * camion, asi que el gasto crece con la flota: mas camiones obligan a
 * espaciar mas las consultas.
 *
 * El intervalo se redondea hacia ARRIBA a multiplos de 15 s. Un valor exacto
 * como "63,7 s" da falsa precision y, al redondear hacia abajo, se pasaria
 * de cuota.
 */
export function planTrafficPolling(
  vehicles: number,
  monthlyQuota = 200_000,
  window: OperatingWindow = DEFAULT_WINDOW,
  headroom = DEFAULT_HEADROOM,
): QuotaPlan {
  const minutes = operatingMinutesPerMonth(window);
  const perMinute = requestsPerMinute(monthlyQuota, window, headroom);

  if (vehicles <= 0 || perMinute <= 0) {
    return { intervalSeconds: 0, monthlyRequests: 0, quotaUsage: 0, minutesPerMonth: minutes };
  }

  const exactSeconds = (vehicles / perMinute) * 60;
  const intervalSeconds = Math.max(15, Math.ceil(exactSeconds / 15) * 15);

  const monthlyRequests = Math.round((minutes * 60 * vehicles) / intervalSeconds);

  return {
    intervalSeconds,
    monthlyRequests,
    quotaUsage: monthlyQuota > 0 ? monthlyRequests / monthlyQuota : 0,
    minutesPerMonth: minutes,
  };
}
