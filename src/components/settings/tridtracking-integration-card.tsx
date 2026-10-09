'use client';
import { gpsDisplayText } from '@/lib/gps-branding';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Satellite, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { TridReadinessReport } from '@/services/gps/tridtracking/tridtracking-readiness';

export function TridTrackingIntegrationCard() {
  const [plate, setPlate] = useState('RBDC59');
  const [imei, setImei] = useState('');
  const [history, setHistory] = useState(false);
  const [report, setReport] = useState<TridReadinessReport | null>(null);
  const test = useMutation({ mutationFn: async (): Promise<TridReadinessReport> => {
    const response = await fetch('/api/gps/3dtracking/probar-conexion', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plate, imei: imei || undefined, history }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'No fue posible probar la conexion.');
    return body;
  }, onSuccess: setReport });
  return <Card>
    <CardHeader title="Conexión GPS Fleet Control" description="Prueba del FMC130 por patente, posicion e historial" icon={<Satellite className="h-4 w-4" />} />
    <CardBody className="space-y-3">
      <p className="text-xs text-ink-faint">El equipo GPS debe estar vinculado con la patente del camión. El IMEI se puede verificar cuando llegue el equipo. La prueba consulta los datos de la cuenta configurada.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="field-label" htmlFor="gps-test-plate">Patente</label><Input id="gps-test-plate" value={plate} disabled={test.isPending} maxLength={10} onChange={(e) => { setPlate(e.target.value.toUpperCase()); setReport(null); }} /></div>
        <div><label className="field-label" htmlFor="gps-test-imei">IMEI opcional</label><Input id="gps-test-imei" value={imei} disabled={test.isPending} maxLength={15} placeholder="15 digitos del FMC130" onChange={(e) => { setImei(e.target.value); setReport(null); }} /></div>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={history} disabled={test.isPending} onChange={(e) => { setHistory(e.target.checked); setReport(null); }} />Comprobar tambien el recorrido de la ultima hora</label>
      <Button variant="secondary" loading={test.isPending} disabled={!plate.trim() || test.isPending || (!!imei && !/^\d{15}$/.test(imei))} icon={<Satellite className="h-4 w-4" />} onClick={() => test.mutate()}>Probar conexión GPS</Button>
      {test.isError ? <p className="text-xs text-status-dormant">{gpsDisplayText(test.error.message)}</p> : null}
      {report ? <div className="space-y-2 rounded-md border border-line bg-surface-800 p-3" aria-live="polite">
        {([['Servidor y cuenta conectados', report.serverReachable], ['Camion encontrado', report.deviceFound], ['Posicion GPS reciente', report.hasPosition], ['Dato de ignicion recibido', report.ignitionKnown],
          ...(report.imeiMatches !== null ? [['IMEI coincide', report.imeiMatches] as const] : []),
          ...(report.historySamples !== null ? [[`Recorrido: ${report.historySamples} muestras`, report.historySamples > 0] as const] : [])] as readonly (readonly [string, boolean])[]).map(([label, ok]) =>
          <div key={label} className="flex items-center gap-2 text-[13px]">{ok ? <CheckCircle2 className="h-4 w-4 text-status-active" /> : <XCircle className="h-4 w-4 text-ink-faint" />}{label}</div>)}
        <p className={`text-xs ${report.ok ? 'text-status-active' : 'text-status-warning'}`}>{gpsDisplayText(report.message)}</p>
        {report.lastPositionAt ? <p className="text-2xs text-ink-faint">Ultima posicion: {new Date(report.lastPositionAt).toLocaleString('es-CL', { timeZone: 'America/Santiago' })}</p> : null}
      </div> : null}
    </CardBody>
  </Card>;
}
