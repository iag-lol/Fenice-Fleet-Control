import type { GpsSensorReading, GpsTelemetry } from '@/types/core';
import type { TridSensorReading, TridUnit } from './tridtracking-types';

const text = (value: unknown, max = 120): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const date = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
};
const numeric = (value: string): number | null => /^[+-]?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? Number(value) : null;

function sensorMetric(type: string, name: string, unit: string, value: number): Pick<GpsSensorReading, 'metric' | 'numericValue'> {
  const kinds = [key(type), key(name)];
  const is = (...names: string[]) => kinds.some((kind) => names.includes(kind));
  const u = unit.trim().toLowerCase();
  if (is('fuellevel', 'fuellevelpercent', 'fuellevelliters', 'nivelcombustible', 'niveldecombustible')) {
    if (['%', 'percent', 'percentage'].includes(u) && value >= 0 && value <= 100) return { metric: 'fuel_percent', numericValue: value };
    if (['l', 'lt', 'liters', 'litres', 'litros'].includes(u) && value >= 0) return { metric: 'fuel_liters', numericValue: value };
  }
  const voltage = ['v', 'volt', 'volts'].includes(u) ? value : u === 'mv' ? value / 1000 : null;
  if (voltage !== null && voltage >= 0) {
    if (voltage <= 100 && is('externalvoltage', 'externalpowervoltage', 'powersupplyvoltage', 'vehiclebatteryvoltage', 'voltajealimentacion')) return { metric: 'supply_voltage', numericValue: voltage };
    if (voltage <= 10 && is('internalbatteryvoltage', 'backupbatteryvoltage', 'bateriainterna')) return { metric: 'backup_voltage', numericValue: voltage };
  }
  if (is('internalbatterylevel', 'backupbatterylevel') && u === '%' && value >= 0 && value <= 100) return { metric: 'backup_percent', numericValue: value };
  if (is('enginerpm', 'enginespeed', 'rpm') && ['rpm', 'r/min'].includes(u) && value >= 0) return { metric: 'engine_rpm', numericValue: value };
  if (is('enginetemperature', 'coolanttemperature', 'enginecoolanttemperature', 'temperaturamotor') && ['°c', 'c', 'celsius'].includes(u)) return { metric: 'engine_temperature', numericValue: value };
  return {};
}

function mapSensor(raw: TridSensorReading, uid: string): GpsSensorReading | null {
  if (!raw || (raw.UnitUid && raw.UnitUid !== uid)) return null;
  const name = text(raw.Name, 80), value = text(raw.Value);
  if (!name || value === '') return null;
  const type = text(raw.SensorType, 80) || null, unit = text(raw.MeasurementSign, 24) || null;
  const number = numeric(value);
  return { name, value, type, unit, measuredAt: date(raw.ReadingTimeUtc), receivedAt: date(raw.ServerTimeUtc),
    ...(number !== null ? sensorMetric(type ?? '', name, unit ?? '', number) : {}) };
}

/** Datos del proveedor conservados con su fecha; nunca modifican el fix GNSS. */
export function mapTridTelemetry(unit: TridUnit): GpsTelemetry {
  const position = unit.Position;
  const inputs = new Map<string, GpsTelemetry['inputs'][number]>();
  for (const raw of Array.isArray(position?.InputOutputs) ? position.InputOutputs : []) {
    if (!raw) continue;
    const code = text(raw.SystemName, 80);
    if (!code) continue;
    inputs.set(code, { code, label: text(raw.UserDescription, 80) || text(raw.Description, 80) || code,
      active: typeof raw.Active === 'boolean' ? raw.Active : null });
  }
  const states = [...inputs.values()];
  const state = (code: string) => states.find((s) => key(s.code) === code)?.active;
  const externalPowerFailure = state('externalpowerfailure'), lowBattery = state('batterylevellow');
  const sensors = (Array.isArray(unit.SensorReadings) ? unit.SensorReadings : [])
    .map((s) => mapSensor(s, unit.Uid ?? '')).filter((s): s is GpsSensorReading => s !== null);
  const engineStatus = text(position?.EngineStatus, 60);
  return { source: '3dtracking', measuredAt: date(position?.GPSTimeUtc), receivedAt: date(position?.ServerTimeUTC),
    ...(engineStatus ? { engineStatus } : {}),
    ...(typeof position?.EngineTime === 'number' && Number.isFinite(position.EngineTime) && position.EngineTime >= 0 ? { engineCounter: position.EngineTime } : {}),
    ...(typeof externalPowerFailure === 'boolean' ? { externalPowerFailure } : {}),
    ...(typeof lowBattery === 'boolean' ? { lowBattery } : {}), inputs: states, sensors };
}
