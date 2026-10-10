import type { DeviceStatus, GpsSensorReading, GpsTelemetry, Position } from '@/types/core';
import { gpsDisplayText } from './gps-branding';
import { formatNumber } from './format';

export function latestTelemetry(position?: Position | null, device?: DeviceStatus | null): GpsTelemetry | null {
  const current = position?.telemetry;
  const status = device?.telemetry;
  if (!current || !status) return status ?? current ?? null;
  const time = (t: GpsTelemetry) => Date.parse(t.receivedAt ?? t.measuredAt ?? '') || 0;
  const base = time(current) > time(status) ? current : status;
  const other = base === current ? status : current;
  if (!other.sensors.length) return base;
  const sensors = new Map<string, GpsSensorReading>();
  for (const row of [...base.sensors, ...other.sensors]) {
    const key = `${row.name}:${row.type}:${row.unit}`;
    const previous = sensors.get(key);
    const at = Date.parse(row.measuredAt ?? row.receivedAt ?? '') || 0;
    const before = previous ? Date.parse(previous.measuredAt ?? previous.receivedAt ?? '') || 0 : -1;
    if (!previous || at > before) sensors.set(key, row);
  }
  return { ...base, sensors: [...sensors.values()] };
}
export function uniqueSensor(telemetry: GpsTelemetry | null, metric: GpsSensorReading['metric']): GpsSensorReading | null {
  const found = telemetry?.sensors.filter((s) => s.metric === metric) ?? [];
  return found.length === 1 ? found[0]! : null;
}
export function telemetryFlag(flag?: boolean): string { return flag === true ? 'Activa' : flag === false ? 'Sin alerta' : 'Sin dato'; }
/** El estado operativo GPS no acredita que el motor funcione: con contacto
 * activo y el camion parado puede llegar `idling` aunque el motor este apagado. */
export function reportedOperationStatus(value?: string): string {
  const labels: Record<string, string> = { idling: 'Contacto activo, sin marcha reportada', running: 'Marcha reportada', stopped: 'Sin marcha reportada', off: 'Contacto apagado', on: 'Contacto encendido' };
  return value ? labels[value.trim().toLowerCase()] ?? gpsDisplayText(value) : 'Sin dato';
}
export function sensorDisplay(sensor: GpsSensorReading | null, unit: string, decimals = 1): string {
  return sensor?.numericValue !== undefined ? `${formatNumber(sensor.numericValue, decimals)} ${unit}` : 'Sin lectura';
}
export function fuelDisplay(telemetry: GpsTelemetry | null): string {
  const readings = telemetry?.sensors.filter((s) => s.metric === 'fuel_percent' || s.metric === 'fuel_liters') ?? [];
  if (readings.length > 1) return `${readings.length} sensores`;
  const sensor = readings[0];
  return sensor ? sensorDisplay(sensor, sensor.metric === 'fuel_percent' ? '%' : 'L') : 'Sin lectura';
}

/** Datos reportados, sin inventar unidades ni porcentajes a partir de voltajes. */
export function exportTelemetryCsv(plate: string, position?: Position | null, device?: DeviceStatus | null): string {
  const telemetry = latestTelemetry(position, device);
  const rows: unknown[][] = [['patente', 'dato', 'valor', 'unidad', 'fecha_medicion_utc', 'fecha_recepcion_utc', 'fuente']];
  const add = (name: string, value: unknown, unit: string, at?: string | null, received?: string | null) => {
    if (value !== undefined && value !== null) rows.push([plate, name, value, unit, at ?? '', received ?? '', 'Fleet Control GPS']);
  };
  add('odometro_gps', position?.odometerKm, 'km', position?.timestamp, position?.receivedAt);
  add('estado_operativo_gps', telemetry?.engineStatus, '', telemetry?.measuredAt, telemetry?.receivedAt);
  add('contador_equipo_gps', telemetry?.engineCounter, 'no_declarada', telemetry?.measuredAt, telemetry?.receivedAt);
  for (const input of telemetry?.inputs ?? []) add(input.label, input.active, 'boolean', telemetry?.measuredAt, telemetry?.receivedAt);
  for (const sensor of telemetry?.sensors ?? []) add(sensor.name, sensor.value, sensor.unit ?? '', sensor.measuredAt, sensor.receivedAt);
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : gpsDisplayText(String(value));
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(?:\.\d+)?$/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return '\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n');
}
