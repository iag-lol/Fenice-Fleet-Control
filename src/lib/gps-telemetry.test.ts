import { expect, it } from 'vitest';
import { exportTelemetryCsv, fuelDisplay, latestTelemetry, reportedOperationStatus, telemetryFlag, uniqueSensor } from './gps-telemetry';
import type { DeviceStatus, GpsTelemetry, Position } from '@/types/core';
const telemetry: GpsTelemetry = { source: '3dtracking', measuredAt: '2026-10-08T15:00:00Z', receivedAt: null, inputs: [], sensors: [] };
it('sin datos no se presenta lleno, vacío, saludable ni sin alertas', () => {
  expect(fuelDisplay(telemetry)).toBe('Sin lectura'); expect(telemetryFlag(undefined)).toBe('Sin dato'); expect(telemetryFlag(false)).toBe('Sin alerta');
});
it('un estado cacheado no oculta una alarma nueva y los sensores conservan su fecha propia', () => {
  const position = { telemetry: { ...telemetry, measuredAt: '2026-10-08T15:10:00Z', receivedAt: '2026-10-08T15:10:02Z', externalPowerFailure: true } } as Position;
  const device = { telemetry: { ...telemetry, externalPowerFailure: false, sensors: [{ name: 'Voltaje', type: 'ExternalVoltage', value: '24.5', unit: 'V', measuredAt: '2026-10-08T15:11:00Z', receivedAt: null, metric: 'supply_voltage', numericValue: 24.5 }] } } as DeviceStatus;
  expect(latestTelemetry(position, device)).toMatchObject({ externalPowerFailure: true, measuredAt: '2026-10-08T15:10:00Z',
    sensors: [expect.objectContaining({ numericValue: 24.5, measuredAt: '2026-10-08T15:11:00Z' })] });
});
it('no suma niveles ni mezcla dos estanques', () => {
  const t = { ...telemetry, sensors: ['Tracción', 'Carga'].map((name) => ({ name, type: 'FuelLevel', value: '50', unit: '%', measuredAt: null, receivedAt: null, metric: 'fuel_percent' as const, numericValue: 50 })) };
  expect(fuelDisplay(t)).toBe('2 sensores'); expect(uniqueSensor(t, 'fuel_percent')).toBeNull();
});
it('prefiere telemetría del equipo aun sin ubicación; conserva fechas y exporta ceros y estados falsos', () => {
  const t = { ...telemetry, engineCounter: 0, inputs: [{ code: 'power', label: 'Alimentación', active: false }], sensors: [{ name: 'Nivel', type: 'FuelLevel', value: '0', unit: '%', measuredAt: '2026-10-08T15:05:00Z', receivedAt: null }] };
  const position = { odometerKm: 0, timestamp: '2026-10-08T15:00:00Z', telemetry } as Position;
  const device = { telemetry: t } as DeviceStatus;
  expect(latestTelemetry(position, device)).toBe(t);
  const csv = exportTelemetryCsv('TEST01', position, device);
  expect(csv).toContain('"contador_equipo_gps","0","no_declarada"'); expect(csv).toContain('"Alimentación","false"');
  expect(csv).toContain('"Nivel","0","%","2026-10-08T15:05:00Z"');
});
it('idling con contacto activo no acredita un motor encendido ni horas de motor', () => {
  const t = { ...telemetry, engineStatus: 'idling', engineCounter: 107256 };
  expect(reportedOperationStatus(t.engineStatus)).toBe('Contacto activo, sin marcha reportada');
  const csv = exportTelemetryCsv('TEST01', { telemetry: t } as Position);
  expect(csv).toContain('"estado_operativo_gps","idling"');
  expect(csv).toContain('"contador_equipo_gps","107256","no_declarada"');
  expect(csv).not.toMatch(/estado_motor|contador_motor|ralentí/i);
});
it('el informe CSV neutraliza fórmulas y escapa comillas sin ejecutar datos del proveedor', () => {
  const t = { ...telemetry, sensors: [{ name: '=HYPERLINK("x")', type: null, value: '+CMD', unit: 'V', measuredAt: null, receivedAt: null }] };
  const csv = exportTelemetryCsv('TEST01', { telemetry: t } as Position);
  expect(csv).toContain("'=HYPERLINK"); expect(csv).toContain("'+CMD"); expect(csv).toContain('""x""');
});

it('los informes descargables usan Fleet Control y no publican marcas de integración', () => {
  const csv = exportTelemetryCsv('TEST01', { telemetry: { ...telemetry, engineCounter: 42,
    sensors: [{ name: '3DTracking Sensor', type: null, value: '12', unit: 'V', measuredAt: null, receivedAt: null }] } } as Position);
  expect(csv).toContain('Fleet Control GPS'); expect(csv).not.toMatch(/3dtracking|traccar|movilmaster|teltonika|proveedor/i);
});
