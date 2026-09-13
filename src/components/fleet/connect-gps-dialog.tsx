'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Satellite, Unlink, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import type { TraccarConnectionTest, VehicleGpsDeviceInfo } from '@/services/fleet/vehicle-gps-device';

/**
 * "Conectar GPS": asocia un vehiculo a un dispositivo Traccar por su
 * identificador. Pensado para que un Traccar Client en un telefono (o, mas
 * adelante, un Teltonika FMC130) empiece a moverse en el mapa sin tocar nada
 * mas que este dialogo.
 */

export interface ConnectGpsDialogProps {
  open: boolean;
  onClose: () => void;
  vehicleId: string;
  vehicleLabel: string;
}

interface DeviceResponse {
  device: VehicleGpsDeviceInfo | null;
}

export function ConnectGpsDialog({ open, onClose, vehicleId, vehicleLabel }: ConnectGpsDialogProps) {
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [testResult, setTestResult] = useState<TraccarConnectionTest | null>(null);

  const { data } = useQuery({
    queryKey: ['vehicle', vehicleId, 'gps-device'],
    enabled: open,
    queryFn: async (): Promise<DeviceResponse> => {
      const response = await fetch(`/api/fleet/${vehicleId}/gps-device`);
      if (!response.ok) throw new Error('No fue posible cargar la configuracion GPS.');
      return (await response.json()) as DeviceResponse;
    },
  });

  // Precarga los campos con lo ya guardado cada vez que se abre el dialogo.
  useEffect(() => {
    if (!open) return;
    setIdentifier(data?.device?.identifier ?? '');
    setServerUrl(data?.device?.serverUrl ?? '');
    setTestResult(null);
  }, [open, data]);

  const test = useMutation({
    mutationFn: async (): Promise<TraccarConnectionTest> => {
      const response = await fetch('/api/gps/traccar/probar-conexion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, serverUrl: serverUrl || undefined }),
      });
      return (await response.json()) as TraccarConnectionTest;
    },
    onSuccess: setTestResult,
  });

  const save = useMutation({
    mutationFn: async (): Promise<{ device?: VehicleGpsDeviceInfo; test: TraccarConnectionTest; error?: string }> => {
      const response = await fetch(`/api/fleet/${vehicleId}/gps-device`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'traccar', identifier, serverUrl: serverUrl || undefined }),
      });
      const body = (await response.json()) as { device?: VehicleGpsDeviceInfo; test: TraccarConnectionTest; error?: string };
      if (!response.ok) throw new Error(body.error ?? 'No fue posible conectar el GPS.');
      return body;
    },
    onSuccess: (result) => {
      setTestResult(result.test);
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      onClose();
    },
  });

  const disconnect = useMutation({
    mutationFn: async (): Promise<void> => {
      const response = await fetch(`/api/fleet/${vehicleId}/gps-device`, { method: 'DELETE' });
      if (!response.ok) throw new Error('No fue posible desconectar el GPS.');
    },
    onSuccess: () => {
      setIdentifier('');
      setServerUrl('');
      setTestResult(null);
      void queryClient.invalidateQueries({ queryKey: ['vehicle', vehicleId] });
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      onClose();
    },
  });

  const busy = test.isPending || save.isPending || disconnect.isPending;
  const canSave = identifier.trim().length > 0 && testResult?.deviceFound === true;

  return (
    <Sheet open={open} onClose={onClose} title="Conectar GPS" description={vehicleLabel}>
      <div className="space-y-4 p-4">
        <div>
          <label className="field-label">Proveedor</label>
          <Select
            value="traccar"
            disabled
            options={[{ value: 'traccar', label: 'Traccar' }]}
          />
          <p className="mt-1 text-2xs text-ink-faint">
            Funciona con Traccar Client (celular) y con hardware GPS que reporte a un servidor
            Traccar, como un Teltonika FMC130.
          </p>
        </div>

        <div>
          <label className="field-label">Identificador del dispositivo</label>
          <Input
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setTestResult(null);
            }}
            placeholder="Ej. 123456789"
            disabled={busy}
          />
          <p className="mt-1 text-2xs text-ink-faint">
            El &ldquo;Device Identifier&rdquo; configurado en Traccar Client, o el IMEI del equipo.
          </p>
        </div>

        <div>
          <label className="field-label">Servidor Traccar (opcional)</label>
          <Input
            value={serverUrl}
            onChange={(e) => {
              setServerUrl(e.target.value);
              setTestResult(null);
            }}
            placeholder="https://gps.midominio.cl"
            disabled={busy}
          />
          <p className="mt-1 text-2xs text-ink-faint">
            Dejalo vacio para usar el servidor configurado por defecto en la plataforma.
          </p>
        </div>

        <Button
          block
          variant="secondary"
          icon={test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Satellite className="h-4 w-4" />}
          disabled={!identifier.trim() || busy}
          onClick={() => test.mutate()}
        >
          Probar conexion
        </Button>

        {testResult ? <ConnectionTestSummary result={testResult} /> : null}

        <div className="flex gap-2 border-t border-line pt-4">
          {data?.device ? (
            <Button
              variant="danger"
              icon={<Unlink className="h-3.5 w-3.5" />}
              disabled={busy}
              loading={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Desconectar
            </Button>
          ) : null}
          <Button
            block
            variant="primary"
            disabled={!canSave || busy}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Guardar
          </Button>
        </div>
        {save.isError ? (
          <p className="text-xs text-status-dormant">{(save.error as Error).message}</p>
        ) : null}
      </div>
    </Sheet>
  );
}

function ConnectionTestSummary({ result }: { result: TraccarConnectionTest }) {
  const rows: { label: string; ok: boolean }[] = [
    { label: 'Servidor conectado', ok: result.serverReachable },
    { label: 'Dispositivo encontrado', ok: result.deviceFound },
    { label: 'GPS transmitiendo', ok: result.hasPosition },
  ];

  return (
    <div className="space-y-2 rounded-md border border-line bg-surface-800 p-3">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-[13px]">
          {row.ok ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-status-active" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0 text-ink-faint" />
          )}
          <span className={row.ok ? 'text-ink' : 'text-ink-faint'}>{row.label}</span>
        </div>
      ))}
      <p className="text-xs text-ink-muted">Para conservar recorridos durante cortes de red, activa el almacenamiento sin conexión del equipo. En Traccar Client permite ubicación en segundo plano y revisa que el ahorro de batería no detenga el servicio.</p>
      <p className={`pt-1 text-xs ${result.ok ? 'text-status-active' : 'text-status-warning'}`}>
        {result.message}
      </p>
      {result.ok ? (
        <div className="pt-1">
          <Badge tone="active" size="sm">
            deviceId {result.externalDeviceId}
          </Badge>
        </div>
      ) : null}
    </div>
  );
}
