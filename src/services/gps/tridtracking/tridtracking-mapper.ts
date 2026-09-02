import type {
  DeviceId,
  DeviceStatus,
  GpsDevice,
  IgnitionState,
  Position,
  Vehicle,
  VehicleId,
  VehicleType,
} from '@/types/core';
import type { TridPosition, TridUnit } from './tridtracking-types';

/**
 * Traduccion de 3DTracking al modelo interno.
 *
 * Vive separado del cliente HTTP a proposito: es logica pura y es donde se
 * concentran las decisiones delicadas de la integracion (unidades de
 * velocidad, fechas sin zona horaria, coordenadas invalidas). Puede probarse
 * sin red y sin credenciales, que es justo lo que hace falta para llegar a
 * la prueba en produccion sin sorpresas.
 */

/** Milla en kilometros, para normalizar velocidades reportadas en mph. */
const KM_PER_MILE = 1.609344;
/** Nudo en km/h, por si algun equipo maritimo reporta en nudos. */
const KMH_PER_KNOT = 1.852;

/**
 * Velocidad normalizada a km/h.
 *
 * `SpeedMeasure` no es fiable ni uniforme entre cuentas. Interpretarlo mal
 * significaria mostrar 100 km/h donde hay 62, y las alertas de exceso de
 * velocidad se dispararian solas. Ante una unidad desconocida se asume km/h,
 * que es la del despliegue chileno, pero se hace explicito aqui.
 */
export function toKmh(speed: number | null | undefined, measure: string | null | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0) return 0;

  const unidad = (measure ?? '').trim().toLowerCase();

  if (unidad.includes('mph') || unidad.includes('mile')) return speed * KM_PER_MILE;
  if (unidad.includes('knot') || unidad === 'kn') return speed * KMH_PER_KNOT;
  if (unidad.includes('m/s') || unidad === 'mps') return speed * 3.6;
  return speed;
}

/** Ignicion: el proveedor la manda como texto libre, no como booleano. */
export function toIgnition(value: string | null | undefined): IgnitionState {
  const v = (value ?? '').trim().toLowerCase();
  if (['on', 'true', '1', 'encendido', 'encendida', 'yes'].includes(v)) return 'on';
  if (['off', 'false', '0', 'apagado', 'apagada', 'no'].includes(v)) return 'off';
  return 'unknown';
}

/**
 * Fecha a ISO con zona.
 *
 * La API entrega marcas UTC que a veces vienen SIN sufijo de zona. Sin el,
 * `Date.parse` las interpreta como hora local del servidor y en Chile eso
 * desplaza las posiciones entre tres y cuatro horas: el sistema creeria que
 * toda la flota lleva horas sin reportar.
 */
export function toIsoUtc(value: string | null | undefined): string | null {
  const texto = (value ?? '').trim();
  if (texto === '') return null;

  const conZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(texto) ? texto : `${texto}Z`;
  const ms = Date.parse(conZona);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Coordenada utilizable.
 *
 * El (0,0) del Golfo de Guinea es el valor que reporta un equipo sin fijacion
 * satelital. Aceptarlo pondria camiones chilenos en mitad del Atlantico.
 */
export function isUsableFix(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  return Math.abs(lat) > 0.0001 || Math.abs(lng) > 0.0001;
}

/** Tipo de vehiculo deducido del texto libre del proveedor. */
export function toVehicleType(unitType: string | null | undefined): VehicleType {
  const t = (unitType ?? '').toLowerCase();
  if (t.includes('semi') || t.includes('trailer') || t.includes('remolque')) {
    return 'cisterna_semirremolque';
  }
  if (t.includes('camioneta') || t.includes('pickup') || t.includes('van')) {
    return 'camioneta_estanque';
  }
  return 'cisterna_rigido';
}

/**
 * Patente del vehiculo.
 *
 * 3DTracking no tiene un campo de patente: el nombre de la unidad es lo que
 * el operador escribio al darla de alta, y suele SER la patente. Se usa tal
 * cual, sin inventar formato, y si falta se cae al IMEI para que la unidad
 * siga siendo identificable en pantalla.
 */
export function toPlate(unit: TridUnit): string {
  const nombre = (unit.Name ?? '').trim();
  if (nombre !== '') return nombre;
  const imei = (unit.Imei ?? '').trim();
  return imei !== '' ? `IMEI ${imei}` : 'Sin identificar';
}

export function mapUnitToVehicle(unit: TridUnit): Vehicle | null {
  const uid = (unit.Uid ?? '').trim();
  if (uid === '') return null;

  const imei = (unit.Imei ?? '').trim();
  const device: GpsDevice | null =
    imei === ''
      ? null
      : {
          id: imei as DeviceId,
          imei,
          model: (unit.UnitType ?? '3DTracking').trim() || '3DTracking',
          externalId: uid,
          ...(unit.PhoneNumber ? { simNumber: unit.PhoneNumber } : {}),
        };

  return {
    id: uid as VehicleId,
    plate: toPlate(unit),
    // El grupo del proveedor hace de codigo de flota cuando existe.
    fleetCode: (unit.GroupName ?? '').trim() || toPlate(unit),
    brand: '',
    model: (unit.UnitType ?? '').trim(),
    year: 0,
    type: toVehicleType(unit.UnitType),
    // Capacidad y compartimentos son datos del ERP de Fenice, no del GPS.
    // Se dejan en cero en lugar de suponer un estanque que no consta.
    capacityLiters: 0,
    compartments: 0,
    device,
    driverId: null,
    // La planta la asigna el ERP de Fenice. Sin el, se deja en blanco en vez
    // de inventar una pertenencia que nadie ha declarado.
    depotName: '',
    active: (unit.Status ?? '').trim().toLowerCase() !== 'inactive',
  };
}

export function mapUnitToPosition(unit: TridUnit): Position | null {
  const uid = (unit.Uid ?? '').trim();
  const p: TridPosition | null = unit.Position ?? null;
  if (uid === '' || p === null) return null;

  const lat = p.Latitude ?? null;
  const lng = p.Longitude ?? null;

  const timestamp =
    toIsoUtc(p.GPSTimeUtc) ?? toIsoUtc(unit.LastReportedTimeUTC) ?? toIsoUtc(p.ServerTimeUTC);
  if (timestamp === null) return null;

  const heading = typeof p.Heading === 'number' && Number.isFinite(p.Heading) ? p.Heading : 0;
  const odometer = p.Odometer ?? unit.OdometerDetails?.Reading ?? null;

  return {
    vehicleId: uid as VehicleId,
    deviceId: ((unit.Imei ?? '').trim() || uid) as DeviceId,
    timestamp,
    ...(toIsoUtc(p.ServerTimeUTC) ? { receivedAt: toIsoUtc(p.ServerTimeUTC)! } : {}),
    lat: lat ?? 0,
    lng: lng ?? 0,
    speed: Math.round(toKmh(p.Speed, p.SpeedMeasure) * 10) / 10,
    heading: ((heading % 360) + 360) % 360,
    ignition: toIgnition(p.Ignition),
    // `valid` gobierna si el resto del sistema puede fiarse de la coordenada.
    valid: isUsableFix(lat, lng),
    ...(typeof odometer === 'number' && Number.isFinite(odometer)
      ? { odometerKm: Math.round(odometer * 10) / 10 }
      : {}),
    ...(p.Address ? { address: p.Address } : {}),
  };
}

/**
 * Estado del equipo.
 *
 * Los umbrales llegan desde la configuracion operacional y no se fijan aqui:
 * lo que para una flota urbana es "sin señal" para una rural es normal.
 */
export function mapUnitToDeviceStatus(
  unit: TridUnit,
  now: Date,
  thresholds: { staleSeconds: number; lostSeconds: number; offlineSeconds: number },
): DeviceStatus | null {
  const uid = (unit.Uid ?? '').trim();
  if (uid === '') return null;

  const last = toIsoUtc(unit.LastReportedTimeUTC) ?? toIsoUtc(unit.Position?.GPSTimeUtc);
  const seconds = last === null ? null : Math.max(0, Math.round((now.getTime() - Date.parse(last)) / 1000));

  const connection: DeviceStatus['connection'] =
    seconds === null
      ? 'unknown'
      : seconds >= thresholds.offlineSeconds
        ? 'offline'
        : seconds >= thresholds.lostSeconds
          ? 'lost'
          : seconds >= thresholds.staleSeconds
            ? 'stale'
            : 'online';

  return {
    deviceId: ((unit.Imei ?? '').trim() || uid) as DeviceId,
    vehicleId: uid as VehicleId,
    ...(unit.Imei ? { imei: unit.Imei } : {}),
    connection,
    lastPositionAt: last,
    secondsSinceLastPosition: seconds,
    protocol: '3DTracking WebApi v1.0',
    ...(unit.UnitType ? { model: unit.UnitType } : {}),
  };
}
