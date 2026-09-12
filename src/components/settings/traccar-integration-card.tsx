'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Loader2, Satellite, XCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { TraccarConnectionTest } from '@/services/fleet/vehicle-gps-device';

/**
 * "Integracion GPS / Traccar".
 *
 * El servidor y las credenciales del proveedor GPS son configuracion de
 * infraestructura (`TRACCAR_BASE_URL`, `TRACCAR_TOKEN`/`TRACCAR_USERNAME`+
 * `TRACCAR_PASSWORD`): viven en el servidor, nunca en el navegador, igual
 * que el resto de credenciales de esta plataforma (ver `.env.example`). Esta
 * tarjeta no las edita; deja probar, de un vistazo, si ya estan bien puestas
 * antes de ir a asociar un vehiculo concreto.
 */
export function TraccarIntegrationCard() {
  const [identifier, setIdentifier] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [result, setResult] = useState<TraccarConnectionTest | null>(null);

  const test = useMutation({
    mutationFn: async (): Promise<TraccarConnectionTest> => {
      const response = await fetch('/api/gps/traccar/probar-conexion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, serverUrl: serverUrl || undefined }),
      });
      return (await response.json()) as TraccarConnectionTest;
    },
    onSuccess: setResult,
  });

  return (
    <Card>
      <CardHeader
        title="Integracion GPS / Traccar"
        description="Traccar Client (celular) o hardware GPS compatible, como un Teltonika FMC130"
        icon={<Satellite className="h-4 w-4" />}
      />
      <CardBody className="space-y-3">
        <p className="text-xs leading-relaxed text-ink-faint">
          El servidor y las credenciales de Traccar se configuran una sola vez en el servidor
          (<code>TRACCAR_BASE_URL</code> y <code>TRACCAR_TOKEN</code>, o usuario y clave). Desde
          aqui puedes probar la conexion sin salir de Configuracion; para asociar un vehiculo
          concreto usa &ldquo;Conectar GPS&rdquo; en su ficha, dentro de Flota.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">Identificador del dispositivo</label>
            <Input
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                setResult(null);
              }}
              placeholder="Ej. 123456789"
            />
          </div>
          <div>
            <label className="field-label">Servidor (opcional)</label>
            <Input
              value={serverUrl}
              onChange={(e) => {
                setServerUrl(e.target.value);
                setResult(null);
              }}
              placeholder="https://gps.midominio.cl"
            />
          </div>
        </div>

        <Button
          variant="secondary"
          icon={test.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Satellite className="h-4 w-4" />}
          disabled={!identifier.trim() || test.isPending}
          onClick={() => test.mutate()}
        >
          Probar conexion
        </Button>

        {result ? (
          <div className="space-y-1.5 rounded-md border border-line bg-surface-800 p-3">
            {(
              [
                ['Servidor conectado', result.serverReachable],
                ['Dispositivo encontrado', result.deviceFound],
                ['GPS transmitiendo', result.hasPosition],
              ] as const
            ).map(([label, ok]) => (
              <div key={label} className="flex items-center gap-2 text-[13px]">
                {ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-status-active" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-ink-faint" />
                )}
                <span className={ok ? 'text-ink' : 'text-ink-faint'}>{label}</span>
              </div>
            ))}
            <p className={`pt-1 text-xs ${result.ok ? 'text-status-active' : 'text-status-warning'}`}>
              {result.message}
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
