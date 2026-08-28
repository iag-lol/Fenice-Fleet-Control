import { formatDistanceToNowStrict, format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';

/** Utilidades de presentacion. Todo el texto visible al usuario es es-CL. */

const clpFormatter = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('es-CL');

export function formatCurrency(value: number): string {
  return clpFormatter.format(value);
}

export function formatNumber(value: number, decimals = 0): string {
  return decimals === 0
    ? numberFormatter.format(Math.round(value))
    : new Intl.NumberFormat('es-CL', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(value);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'HH:mm', { locale: es }) : '--:--';
}

export function formatTimeWithSeconds(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'HH:mm:ss', { locale: es }) : '--:--:--';
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy', { locale: es }) : 'Sin fecha';
}

/** "hoy 14:32", "ayer 09:10" o "12 mar 2026 08:44". */
export function formatSmartDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'Sin registro';
  if (isToday(date)) return `Hoy ${format(date, 'HH:mm', { locale: es })}`;
  if (isYesterday(date)) return `Ayer ${format(date, 'HH:mm', { locale: es })}`;
  return format(date, "dd MMM yyyy HH:mm", { locale: es });
}

export function formatRelative(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'Sin registro';
  return `hace ${formatDistanceToNowStrict(date, { locale: es })}`;
}

/**
 * Antiguedad de la telemetria, en el formato que la operacion espera leer de
 * un vistazo: "hace 12 s", "hace 4 min", "hace 2 h 10 min".
 */
export function formatElapsed(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'sin datos';
  if (seconds < 60) return `hace ${Math.max(0, Math.round(seconds))} s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) {
    return restMinutes === 0 ? `hace ${hours} h` : `hace ${hours} h ${restMinutes} min`;
  }

  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

/** Duracion legible a partir de segundos: "1 h 24 min", "9 min", "45 s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;

  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
}

export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '--';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${formatNumber(meters / 1000, 1)} km`;
}

export function formatKm(km: number | null | undefined): string {
  if (km === null || km === undefined || !Number.isFinite(km)) return '--';
  return `${formatNumber(km, 1)} km`;
}

export function formatSpeed(kmh: number | null | undefined): string {
  if (kmh === null || kmh === undefined || !Number.isFinite(kmh)) return '--';
  return `${Math.round(kmh)} km/h`;
}

export function formatDays(days: number | null): string {
  if (days === null) return 'Sin registro';
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 dia';
  return `${formatNumber(days)} dias`;
}

export function formatPercent(ratio: number, decimals = 0): string {
  return `${formatNumber(ratio * 100, decimals)} %`;
}

/** Rumbo en grados a punto cardinal. */
export function formatHeading(degrees: number | null | undefined): string {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return '--';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return `${points[index]} (${Math.round(degrees)}°)`;
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** ETA en lenguaje operativo: "28 min", "1 h 05 min", "llegando". */
export function formatEta(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return 'No disponible';
  if (minutes < 1) return 'Llegando';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')} min`;
}

/** Normaliza texto para busqueda: minusculas y sin acentos. */
export function normalizeSearch(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}
