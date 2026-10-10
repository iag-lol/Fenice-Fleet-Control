'use client';
import { gpsDisplayText } from '@/lib/gps-branding';
import { Download } from 'lucide-react';
import type { DeviceStatus, GpsSensorReading, Position } from '@/types/core';
import { DetailList } from '@/components/common/detail-list';
import { formatNumber, formatSmartDateTime } from '@/lib/format';
import { exportTelemetryCsv, fuelDisplay, latestTelemetry, reportedOperationStatus, sensorDisplay, telemetryFlag, uniqueSensor } from '@/lib/gps-telemetry';

export function DeviceTelemetry({ plate, position, device }: { plate: string; position?: Position | null; device?: DeviceStatus | null }) {
  const telemetry = latestTelemetry(position, device);
  const reading = (sensor: GpsSensorReading | null, unit: string, decimals = 1) => sensor?.numericValue !== undefined
    ? <span className="flex flex-col"><span>{sensorDisplay(sensor, unit, decimals)}</span><span className="mt-0.5 text-[10px] font-normal text-ink-faint">{sensor.measuredAt ? formatSmartDateTime(sensor.measuredAt) : 'Sin fecha'}</span></span>
    : 'Sin lectura';
  const fuel = telemetry?.sensors.filter((s) => s.metric === 'fuel_percent' || s.metric === 'fuel_liters') ?? [];
  const supply = uniqueSensor(telemetry, 'supply_voltage');
  const backup = uniqueSensor(telemetry, 'backup_voltage');
  const charge = uniqueSensor(telemetry, 'backup_percent');
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportTelemetryCsv(plate, position, device)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `telemetria-${plate.replace(/[^a-z0-9-]/gi, '')}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-ink-faint">Registro {formatSmartDateTime(telemetry?.measuredAt ?? position?.timestamp)}</span>
      <button type="button" onClick={download} disabled={!telemetry && !position} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-2xs text-ink-muted hover:border-brand-500/40 disabled:opacity-40"><Download className="h-3 w-3" />Informe CSV</button>
    </div>
    <DetailList columns={2} items={[
      { label: 'Odómetro del equipo', value: position?.odometerKm !== undefined ? `${formatNumber(position.odometerKm, 2)} km` : 'Sin dato' },
      { label: 'Estado GPS', value: reportedOperationStatus(telemetry?.engineStatus) },
      { label: 'Alimentación externa', value: telemetryFlag(telemetry?.externalPowerFailure) },
      { label: 'Alerta batería del GPS', value: telemetryFlag(telemetry?.lowBattery) },
      ...(supply ? [{ label: 'Voltaje alimentación', value: reading(supply, 'V', 2) }] : []),
      ...(backup ? [{ label: 'Batería interna GPS', value: reading(backup, 'V', 2) }] : []),
      ...(charge ? [{ label: 'Carga batería GPS', value: reading(charge, '%') }] : []),
      ...(fuel.length ? [{ label: 'Nivel combustible', value: fuel.length === 1 ? reading(fuel[0]!, fuel[0]!.metric === 'fuel_percent' ? '%' : 'L') : fuelDisplay(telemetry) }] : []),
      ...(uniqueSensor(telemetry, 'engine_rpm') ? [{ label: 'RPM reportadas', value: reading(uniqueSensor(telemetry, 'engine_rpm'), 'rpm', 0) }] : []),
      ...(uniqueSensor(telemetry, 'engine_temperature') ? [{ label: 'Temperatura motor', value: reading(uniqueSensor(telemetry, 'engine_temperature'), '°C') }] : []),
    ]} />
    {telemetry?.inputs.some((s) => !['externalpowerfailure', 'batterylevellow'].includes(s.code.toLowerCase())) ? <details className="rounded-md border border-line px-2.5 py-2 text-2xs text-ink-muted"><summary className="cursor-pointer">Señales adicionales</summary><ul className="mt-2 space-y-2">{telemetry.inputs.filter((s) => !['externalpowerfailure', 'batterylevellow'].includes(s.code.toLowerCase())).map((s) => <li key={s.code} className="flex justify-between gap-3"><span>{gpsDisplayText(s.label)}</span><span>{s.active === true ? 'Activa' : s.active === false ? 'No activa' : 'Sin dato'}</span></li>)}</ul></details> : null}
    {telemetry?.engineCounter !== undefined ? <details className="rounded-md border border-line bg-surface-800/50 px-2.5 py-2 text-2xs text-ink-faint"><summary className="cursor-pointer">Contador del equipo</summary><div className="mt-2 flex items-center justify-between"><span>Registro acumulado · unidad no declarada</span><span className="numeric font-medium text-ink">{formatNumber(telemetry.engineCounter, Number.isInteger(telemetry.engineCounter) ? 0 : 2)}</span></div></details> : null}
    {telemetry?.sensors.length ? <details className="rounded-md border border-line px-2.5 py-2 text-xs text-ink-muted"><summary className="cursor-pointer">Sensores reportados · {telemetry.sensors.length}</summary><ul className="mt-2 space-y-2">{telemetry.sensors.map((sensor, i) => <li key={`${gpsDisplayText(sensor.name)}-${i}`} className="border-t border-line pt-2"><div className="flex justify-between gap-3"><span>{gpsDisplayText(sensor.name)}</span><span className="numeric font-medium text-ink">{gpsDisplayText(sensor.value)} {gpsDisplayText(sensor.unit)}</span></div><span className="text-[10px] text-ink-faint">{formatSmartDateTime(sensor.measuredAt)}</span></li>)}</ul></details> : null}
  </div>;
}
