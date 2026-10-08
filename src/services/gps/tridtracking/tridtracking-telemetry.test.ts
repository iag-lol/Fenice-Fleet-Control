import { describe, expect, it } from 'vitest';
import { mapTridTelemetry } from './tridtracking-telemetry';
import { mapUnitToDeviceStatus, mapUnitToPosition } from './tridtracking-mapper';
import type { TridSensorReading, TridUnit } from './tridtracking-types';
const unit: TridUnit = { Uid: 'u1', Imei: '359632100000001', LastReportedTimeUTC: '2026-10-08T15:10:00Z',
  Position: { Latitude: -33.45, Longitude: -70.66, GPSTimeUtc: '2026-10-08T15:00:00Z', ServerTimeUTC: '2026-10-08T15:00:03Z',
    Speed: 0, Ignition: 'On', Odometer: 3.54, EngineStatus: 'idling', EngineTime: 102392,
    InputOutputs: [{ SystemName: 'externalpowerfailure', Active: false }, { SystemName: 'batterylevellow', Active: false }] }, SensorReadings: [] };
const sensor = (values: Partial<TridSensorReading> = {}): TridSensorReading => ({ UnitUid: 'u1', Name: 'Nivel combustible', SensorType: 'FuelLevel', Value: '0', MeasurementSign: '%', ReadingTimeUtc: '2026-10-08T15:05:00', ...values });
describe('telemetría real de 3DTracking', () => {
  it('conserva estados inactivos y contador sin inventar porcentaje de batería, combustible u horas', () => {
    const t = mapTridTelemetry(unit);
    expect(t).toMatchObject({ externalPowerFailure: false, lowBattery: false, engineStatus: 'idling', engineCounter: 102392, sensors: [] });
    expect(mapUnitToPosition(unit)?.batteryLevel).toBeUndefined();
    expect(mapUnitToPosition(unit)?.odometerKm).toBe(3.54);
  });
  it('la telemetría no renueva el fix y sigue disponible aunque no haya ubicación GNSS', () => {
    const current = { ...unit, SensorReadings: [sensor()] };
    expect(mapUnitToPosition(current)?.timestamp).toBe('2026-10-08T15:00:00.000Z');
    const missingFix = { ...current, Position: { ...current.Position, GPSTimeUtc: null } };
    expect(mapUnitToPosition(missingFix)).toBeNull();
    expect(mapUnitToDeviceStatus(missingFix, new Date('2026-10-08T15:11:00Z'), { staleSeconds: 60, lostSeconds: 180, offlineSeconds: 600 })?.telemetry?.sensors).toHaveLength(1);
  });
  it('ausencia, null o valores numéricos de Active no se convierten en falso', () => {
    const t = mapTridTelemetry({ Uid: 'u1', Position: { InputOutputs: [{ SystemName: 'externalpowerfailure' }, { SystemName: 'batterylevellow', Active: null }] } });
    expect(t.externalPowerFailure).toBeUndefined(); expect(t.lowBattery).toBeUndefined();
    expect(t.inputs.every((s) => s.active === null)).toBe(true);
  });
  it('nivel cero es una lectura real y no un campo ausente', () => {
    const t = mapTridTelemetry({ ...unit, SensorReadings: [sensor()] });
    expect(t.sensors[0]).toMatchObject({ metric: 'fuel_percent', numericValue: 0, value: '0', unit: '%', measuredAt: '2026-10-08T15:05:00.000Z' });
  });
  it.each([
    { SensorType: 'FuelConsumption', Name: 'Consumo combustible', Value: '30', MeasurementSign: 'L' },
    { Value: '200', MeasurementSign: '%' },
    { Value: '30', MeasurementSign: null },
    { Value: '1,234', MeasurementSign: 'L' },
    { Value: 'NaN', MeasurementSign: '%' },
  ])('no presenta consumo, unidades desconocidas o valores ambiguos como nivel (%#)', (reading) => {
    expect(mapTridTelemetry({ ...unit, SensorReadings: [sensor(reading)] }).sensors[0]?.metric).toBeUndefined();
  });
  it('convierte mV a V sin inferir carga porcentual ni confundir respaldo con alimentación', () => {
    const t = mapTridTelemetry({ ...unit, SensorReadings: [sensor({ Name: 'Respaldo', SensorType: 'InternalBatteryVoltage', Value: '3920', MeasurementSign: 'mV' }), sensor({ Name: 'Alimentación', SensorType: 'ExternalVoltage', Value: '24.8', MeasurementSign: 'V' })] });
    expect(t.sensors.map((s) => [s.metric, s.numericValue])).toEqual([['backup_voltage', 3.92], ['supply_voltage', 24.8]]);
    expect(t.sensors.some((s) => s.metric === 'backup_percent')).toBe(false);
  });
  it('descarta sensores explícitamente pertenecientes a otro GPS y conserva sensores desconocidos propios', () => {
    const t = mapTridTelemetry({ ...unit, SensorReadings: [sensor({ UnitUid: 'other' }), sensor({ Name: 'Sonda adicional', SensorType: 'Custom', Value: '37.8', MeasurementSign: 'u' })] });
    expect(t.sensors).toHaveLength(1); expect(t.sensors[0]).toMatchObject({ name: 'Sonda adicional', value: '37.8', unit: 'u' });
  });
  it('conserva cero de contador y odómetro; rechaza distancias negativas', () => {
    expect(mapTridTelemetry({ ...unit, Position: { ...unit.Position, EngineTime: 0 } }).engineCounter).toBe(0);
    expect(mapUnitToPosition({ ...unit, Position: { ...unit.Position, Odometer: 0 } })?.odometerKm).toBe(0);
    expect(mapUnitToPosition({ ...unit, Position: { ...unit.Position, Odometer: -5 } })?.odometerKm).toBeUndefined();
  });
});
