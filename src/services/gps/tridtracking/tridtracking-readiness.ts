import 'server-only';
import type { GpsProvider } from '@/services/gps/gps-provider';
import type { Position } from '@/types/core';
import { TridTrackingError } from './tridtracking-client';

export interface TridReadinessReport {
  ok: boolean;
  plate: string;
  serverReachable: boolean;
  deviceFound: boolean;
  hasPosition: boolean;
  imeiMatches: boolean | null;
  ignitionKnown: boolean;
  lastPositionAt: string | null;
  ageSeconds: number | null;
  historySamples: number | null;
  message: string;
  checkedAt: string;
}
export function normalizePlate(plate: string): string { return plate.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** Solo lectura: verifica la cadena proveedor -> camion -> fix, sin crear asociaciones. */
export async function checkTridReadiness(gps: GpsProvider, input: {
  plate: string; imei?: string; history?: boolean; maxAgeSeconds: number;
}, now = new Date()): Promise<TridReadinessReport> {
  const report: TridReadinessReport = { ok: false, plate: normalizePlate(input.plate),
    serverReachable: false, deviceFound: false, hasPosition: false, imeiMatches: null,
    ignitionKnown: false, lastPositionAt: null, ageSeconds: null, historySamples: null,
    message: '', checkedAt: now.toISOString() };
  if (gps.info.id !== '3dtracking') return { ...report, message: '3DTracking no esta activo. Configura el proveedor y sus credenciales en el servidor.' };
  const health = await gps.healthCheck?.();
  if (health && !health.ok) return { ...report, message: health.message };
  report.serverReachable = true;
  let vehicles, positions: Position[];
  try { [vehicles, positions] = await Promise.all([gps.getVehicles(), gps.getAllCurrentPositions()]); }
  catch (error) { return { ...report, message: error instanceof TridTrackingError && error.status === 429
    ? error.message
    : '3DTracking responde, pero no fue posible consultar flota y posiciones. Revisa los permisos de la cuenta.' }; }
  const matches = vehicles.filter((v) => normalizePlate(v.plate) === report.plate);
  if (!matches.length) return { ...report, message: `No aparece ${report.plate} en la cuenta. Da de alta el FMC130 en 3DTracking con esa patente y confirma el acceso de la cuenta API.` };
  if (matches.length !== 1) return { ...report, message: `Hay varias unidades con la patente ${report.plate}. Corrige el registro antes de probar.` };
  const vehicle = matches[0]!;
  report.deviceFound = true;
  report.imeiMatches = input.imei ? vehicle.device?.imei === input.imei : null;
  if (report.imeiMatches === false) return { ...report, message: 'La patente aparece, pero el IMEI no coincide con el equipo ingresado.' };
  const latest = positions.filter((p) => p.vehicleId === vehicle.id && p.valid &&
    Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0) && Number.isFinite(Date.parse(p.timestamp)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (latest) {
    report.lastPositionAt = latest.timestamp;
    report.ageSeconds = Math.round((now.getTime() - Date.parse(latest.timestamp)) / 1000);
    report.hasPosition = report.ageSeconds >= -60 && report.ageSeconds < input.maxAgeSeconds;
    report.ignitionKnown = latest.ignition !== 'unknown';
  }
  if (gps.getAvailabilityWarnings?.().length) {
    return { ...report, message: 'Se conservan datos GPS guardados, pero una consulta del proveedor no está disponible. No se puede confirmar la instalación hasta recuperar las consultas.' };
  }
  if (input.history) {
    try {
      const history = await gps.getPositionHistory({ vehicleId: vehicle.id,
        from: new Date(now.getTime() - 3_600_000).toISOString(), to: now.toISOString(), limit: 5000 });
      report.historySamples = history.length;
    } catch { return { ...report, message: 'No fue posible consultar el recorrido de la ultima hora. Revisa permisos de historial y disponibilidad del proveedor.' }; }
  }
  report.ok = report.hasPosition && report.ignitionKnown && (!input.history || report.historySamples! > 0);
  report.message = !latest ? 'Unidad encontrada, pero todavia no hay una posicion GPS valida.'
    : report.ageSeconds! < -60 ? 'El reloj GPS esta adelantado. Revisa la sincronizacion de hora del equipo.'
    : !report.hasPosition ? 'La ultima posicion esta fuera del umbral de señal. Revisa cobertura y frecuencia de envio.'
    : input.history && !report.historySamples ? 'La posicion es reciente, pero el recorrido de la ultima hora esta vacio.'
    : !report.ignitionKnown ? 'Posicion reciente recibida. Falta validar el dato de ignicion del FMC130.'
    : '3DTracking conectado, camion encontrado y posicion GPS reciente recibida.';
  return report;
}
