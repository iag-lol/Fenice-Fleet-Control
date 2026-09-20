'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Check,
  Database,
  RotateCcw,
  Satellite,
  Save,
  Shield,
  Route as RouteIcon,
  Warehouse,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { NumberField, Select, Toggle } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import { TraccarIntegrationCard } from '@/components/settings/traccar-integration-card';
import {
  GEOFENCE_RADIUS_PRESETS,
  validateSettingsCoherence,
  type OperationalSettings,
} from '@/config/operational';
import type { SystemModeInfo } from '@/services/registry';

interface SystemModeResponse extends SystemModeInfo {
  settings: OperationalSettings;
}

/**
 * Configuracion operacional.
 *
 * Los valores que se editan aqui alimentan directamente a los motores de
 * reglas: cambiar el umbral de cliente dormido recalcula los pines del mapa,
 * los KPIs y las alertas en la siguiente lectura.
 */
export function SettingsView() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OperationalSettings | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['system', 'mode'],
    queryFn: async (): Promise<SystemModeResponse> => {
      const response = await fetch('/api/system/mode');
      if (!response.ok) throw new Error('No fue posible cargar la configuracion.');
      return (await response.json()) as SystemModeResponse;
    },
  });

  useEffect(() => {
    if (data?.settings && draft === null) setDraft(data.settings);
  }, [data, draft]);

  const save = useMutation({
    mutationFn: async (settings: OperationalSettings): Promise<OperationalSettings> => {
      const response = await fetch('/api/configuracion', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { issues?: string[] } | null;
        throw new Error(body?.issues?.join(' ') ?? 'La configuracion no es valida.');
      }
      return (await response.json()) as OperationalSettings;
    },
    onSuccess: (settings) => {
      setDraft(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      // Los umbrales cambian estados calculados: invalidar todo lo derivado.
      void queryClient.invalidateQueries();
    },
  });

  const reset = useMutation({
    mutationFn: async (): Promise<OperationalSettings> => {
      const response = await fetch('/api/configuracion', { method: 'DELETE' });
      if (!response.ok) throw new Error('No fue posible restaurar la configuracion.');
      return (await response.json()) as OperationalSettings;
    },
    onSuccess: (settings) => {
      setDraft(settings);
      void queryClient.invalidateQueries();
    },
  });

  if (isError) {
    return (
      <>
        <PageHeader title="Configuracion operacional" />
        <QueryError
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </>
    );
  }

  if (isLoading || !draft || !data) {
    return (
      <>
        <PageHeader title="Configuracion operacional" />
        <SkeletonRows rows={8} />
      </>
    );
  }

  const coherenceErrors = validateSettingsCoherence(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  const update = <K extends keyof OperationalSettings>(
    section: K,
    values: Partial<OperationalSettings[K]>,
  ): void => {
    setDraft((current) =>
      current === null ? current : { ...current, [section]: { ...current[section], ...values } },
    );
  };

  const numberOr = (value: string, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return (
    <>
      <PageHeader
        title="Configuracion operacional"
        description="Umbrales que gobiernan el estado comercial de clientes, la salud del GPS, el control de ruta y las geocercas de entrega."
        actions={
          <>
            <LinkButton
              href="/configuracion/geocercas"
              variant="secondary"
              size="sm"
              icon={<Shield className="h-3.5 w-3.5" />}
            >
              Editor de geocercas
            </LinkButton>
            <LinkButton
              href="/configuracion/puntos-partida"
              variant="secondary"
              size="sm"
              icon={<Warehouse className="h-3.5 w-3.5" />}
            >
              Puntos de partida
            </LinkButton>
            <Button
              variant="ghost"
              size="sm"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              loading={reset.isPending}
              onClick={() => reset.mutate()}
            >
              Restaurar valores de entorno
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              loading={save.isPending}
              disabled={!dirty || coherenceErrors.length > 0}
              onClick={() => save.mutate(draft)}
            >
              {saved ? 'Configuracion aplicada' : 'Guardar cambios'}
            </Button>
          </>
        }
      />

      {coherenceErrors.length > 0 ? (
        <div className="mb-4 rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2.5">
          <p className="text-[13px] font-medium text-ink">Revisa los umbrales</p>
          <ul className="mt-1 space-y-0.5">
            {coherenceErrors.map((message) => (
              <li key={message} className="text-xs text-status-warning">
                · {message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {save.isError ? (
        <div className="mb-4">
          <QueryError
            compact
            title="No fue posible guardar"
            message={save.error instanceof Error ? save.error.message : undefined}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Clientes --- */}
        <Card>
          <CardHeader
            title="Estado comercial de clientes"
            description="Define cuando un cliente pasa de verde a amarillo y a rojo"
            icon={<Building2 className="h-4 w-4" />}
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Cliente activo hasta"
                suffix="dias"
                min={1}
                max={365}
                value={draft.clients.activeMaxDays}
                onChange={(event) =>
                  update('clients', {
                    activeMaxDays: numberOr(event.target.value, draft.clients.activeMaxDays),
                  })
                }
                hint="Verde: dias sin comprar menores o iguales a este valor."
              />
              <NumberField
                label="En observacion hasta"
                suffix="dias"
                min={2}
                max={1095}
                value={draft.clients.warningMaxDays}
                onChange={(event) =>
                  update('clients', {
                    warningMaxDays: numberOr(event.target.value, draft.clients.warningMaxDays),
                  })
                }
                hint="Amarillo hasta este valor; por encima, rojo (dormido)."
              />
            </div>

            <div className="rounded-md border border-line bg-surface-900 px-3 py-2.5">
              <p className="text-2xs uppercase tracking-wider text-ink-faint">Reglas resultantes</p>
              <ul className="mt-1.5 space-y-1 text-xs">
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-status-active" />
                  <span className="text-ink-muted">
                    Activo: 0 a {draft.clients.activeMaxDays} dias sin comprar
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-status-warning" />
                  <span className="text-ink-muted">
                    En observacion: {draft.clients.activeMaxDays + 1} a {draft.clients.warningMaxDays}{' '}
                    dias
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-status-dormant" />
                  <span className="text-ink-muted">
                    Dormido: mas de {draft.clients.warningMaxDays} dias
                  </span>
                </li>
              </ul>
            </div>

            <Toggle
              label="Considerar la visita comercial como senal de actividad"
              hint="Si esta activo, una visita reciente atenua el riesgo aunque no exista compra."
              checked={draft.clients.useVisitAsActivitySignal}
              onChange={(checked) => update('clients', { useVisitAsActivitySignal: checked })}
            />
          </CardBody>
        </Card>

        {/* --- GPS --- */}
        <Card>
          <CardHeader
            title="Salud de la telemetria GPS"
            description="Escalonamiento entre advertencia, perdida de senal y offline"
            icon={<Satellite className="h-4 w-4" />}
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Advertencia sin posicion"
                suffix="s"
                min={15}
                max={3600}
                value={draft.gps.staleSeconds}
                onChange={(event) =>
                  update('gps', { staleSeconds: numberOr(event.target.value, draft.gps.staleSeconds) })
                }
              />
              <NumberField
                label="Posible perdida de senal"
                suffix="s"
                min={30}
                max={7200}
                value={draft.gps.signalLostSeconds}
                onChange={(event) =>
                  update('gps', {
                    signalLostSeconds: numberOr(event.target.value, draft.gps.signalLostSeconds),
                  })
                }
              />
              <NumberField
                label="Vehiculo offline"
                suffix="s"
                min={60}
                max={86400}
                value={draft.gps.offlineSeconds}
                onChange={(event) =>
                  update('gps', {
                    offlineSeconds: numberOr(event.target.value, draft.gps.offlineSeconds),
                  })
                }
              />
              <NumberField
                label="Cadencia de refresco"
                suffix="ms"
                min={3000}
                max={120000}
                step={1000}
                value={draft.gps.refreshIntervalMs}
                onChange={(event) =>
                  update('gps', {
                    refreshIntervalMs: numberOr(event.target.value, draft.gps.refreshIntervalMs),
                  })
                }
              />
            </div>

            <NumberField
              label="Umbral de movimiento"
              suffix="km/h"
              min={0}
              max={30}
              value={draft.gps.movingSpeedThresholdKmh}
              onChange={(event) =>
                update('gps', {
                  movingSpeedThresholdKmh: numberOr(
                    event.target.value,
                    draft.gps.movingSpeedThresholdKmh,
                  ),
                })
              }
              hint="Por debajo de esta velocidad el vehiculo se considera detenido."
            />
          </CardBody>
        </Card>

        {/* --- Ruta --- */}
        <Card>
          <CardHeader
            title="Control de ruta"
            description="Tolerancias de desvio, zona y detencion"
            icon={<RouteIcon className="h-4 w-4" />}
          />
          <CardBody className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Tolerancia de desvio"
                suffix="m"
                min={25}
                max={5000}
                value={draft.route.deviationDistanceMeters}
                onChange={(event) =>
                  update('route', {
                    deviationDistanceMeters: numberOr(
                      event.target.value,
                      draft.route.deviationDistanceMeters,
                    ),
                  })
                }
                hint="Distancia al corredor planificado."
              />
              <NumberField
                label="Tiempo fuera de ruta"
                suffix="s"
                min={10}
                max={3600}
                value={draft.route.deviationTimeSeconds}
                onChange={(event) =>
                  update('route', {
                    deviationTimeSeconds: numberOr(
                      event.target.value,
                      draft.route.deviationTimeSeconds,
                    ),
                  })
                }
                hint="Permanencia continua antes de alertar."
              />
              <NumberField
                label="Tolerancia fuera de comuna"
                suffix="s"
                min={30}
                max={7200}
                value={draft.route.outOfCommuneToleranceSeconds}
                onChange={(event) =>
                  update('route', {
                    outOfCommuneToleranceSeconds: numberOr(
                      event.target.value,
                      draft.route.outOfCommuneToleranceSeconds,
                    ),
                  })
                }
              />
              <NumberField
                label="Detencion prolongada"
                suffix="s"
                min={60}
                max={14400}
                value={draft.route.prolongedStopSeconds}
                onChange={(event) =>
                  update('route', {
                    prolongedStopSeconds: numberOr(
                      event.target.value,
                      draft.route.prolongedStopSeconds,
                    ),
                  })
                }
              />
              <NumberField
                label="Velocidad maxima legal"
                suffix="km/h"
                min={20}
                max={150}
                value={draft.route.maxLegalSpeedKmh}
                onChange={(event) =>
                  update('route', {
                    maxLegalSpeedKmh: numberOr(event.target.value, draft.route.maxLegalSpeedKmh),
                  })
                }
                hint="Por encima de esta velocidad, el historial GPS marca exceso."
              />
            </div>

            <p className="rounded-md border border-line bg-surface-900 px-3 py-2 text-2xs leading-relaxed text-ink-faint">
              Una sola posicion fuera del corredor no genera alerta: se exige permanencia continua
              durante el tiempo configurado, porque los equipos GPS tienen dispersion y las maniobras
              puntuales se alejan de la ruta sin ser un desvio real.
            </p>
          </CardBody>
        </Card>

        {/* --- Geocercas --- */}
        <Card>
          <CardHeader
            title="Geocercas de entrega"
            description="Radio por direccion y validacion de visita"
            icon={<Shield className="h-4 w-4" />}
          />
          <CardBody className="space-y-3">
            <div>
              <label className="field-label" htmlFor="radio-geocerca">
                Radio predeterminado
              </label>
              <Select
                id="radio-geocerca"
                value={String(draft.geofence.defaultRadiusMeters)}
                onChange={(event) =>
                  update('geofence', { defaultRadiusMeters: Number(event.target.value) })
                }
                options={[
                  ...GEOFENCE_RADIUS_PRESETS.map((radius) => ({
                    value: String(radius),
                    label: `${radius} metros`,
                  })),
                  ...(GEOFENCE_RADIUS_PRESETS.includes(
                    draft.geofence.defaultRadiusMeters as (typeof GEOFENCE_RADIUS_PRESETS)[number],
                  )
                    ? []
                    : [
                        {
                          value: String(draft.geofence.defaultRadiusMeters),
                          label: `${draft.geofence.defaultRadiusMeters} metros (personalizado)`,
                        },
                      ]),
                ]}
              />
              <p className="mt-1 text-2xs text-ink-faint">
                Cada direccion de despacho genera automaticamente una geocerca con este radio, salvo
                que tenga uno propio configurado.
              </p>
            </div>

            <NumberField
              label="Permanencia minima en geocerca"
              suffix="s"
              min={0}
              max={3600}
              value={draft.geofence.minDwellSeconds}
              onChange={(event) =>
                update('geofence', {
                  minDwellSeconds: numberOr(event.target.value, draft.geofence.minDwellSeconds),
                })
              }
              hint="Evita falsos positivos por vehiculos que solo pasan frente al domicilio."
            />

            <Toggle
              label="Confirmar entrega automaticamente al cumplir la permanencia"
              hint="Si se desactiva, la visita queda registrada como evidencia pero la entrega requiere confirmacion humana."
              checked={draft.geofence.autoConfirmDeliveryOnDwell}
              onChange={(checked) => update('geofence', { autoConfirmDeliveryOnDwell: checked })}
            />

            <NumberField
              label="Radio personalizado"
              suffix="m"
              min={20}
              max={2000}
              value={draft.geofence.defaultRadiusMeters}
              onChange={(event) =>
                update('geofence', {
                  defaultRadiusMeters: numberOr(
                    event.target.value,
                    draft.geofence.defaultRadiusMeters,
                  ),
                })
              }
              hint="Usa este campo si necesitas un valor distinto a los preajustes."
            />
          </CardBody>
        </Card>

        <TraccarIntegrationCard />

        {/* --- Estado del sistema --- */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Estado de las integraciones"
            description="Fuentes de datos activas y como cambiarlas"
            icon={<Database className="h-4 w-4" />}
          />
          <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <IntegrationTile
              title="Telemetria GPS"
              value={data.gps.label}
              simulated={data.gps.simulated}
              detail={
                data.gps.simulated
                  ? 'Simulador integrado. Activa el servidor real con GPS_PROVIDER=traccar y las variables TRACCAR_*.'
                  : `Conectado por ${data.gps.transport}.`
              }
            />
            <IntegrationTile
              title="Fuente operacional"
              value={data.operations.label}
              simulated={data.operations.simulated}
              detail={
                data.operations.simulated
                  ? 'Dataset de demostracion. Conecta la base de Fenice con OPERATIONS_PROVIDER=external y credenciales de solo lectura.'
                  : 'Conexion de solo lectura activa.'
              }
            />
            <IntegrationTile
              title="Calculo de ETA"
              value={data.routingProvider === 'estimated' ? 'Estimacion interna' : data.routingProvider}
              simulated={data.routingProvider === 'estimated'}
              detail={
                data.routingProvider === 'estimated'
                  ? 'Estimacion propia sobre el corredor planificado. Configura ROUTING_PROVIDER para usar un proveedor de ruteo real.'
                  : 'Proveedor de ruteo externo activo.'
              }
            />
            <IntegrationTile
              title="Geocodificacion"
              value={data.geocodingProvider === 'none' ? 'Desactivada' : data.geocodingProvider}
              simulated={data.geocodingProvider === 'none'}
              detail={
                data.geocodingProvider === 'none'
                  ? 'Sin proveedor configurado. Las direcciones sin coordenadas se reportan como alerta operacional.'
                  : 'Resolucion de direcciones activa, con cache para evitar consultas repetidas.'
              }
            />
          </CardBody>

          <CardBody className="border-t border-line">
            <p className="text-2xs leading-relaxed text-ink-faint">
              La configuracion se aplica de inmediato a todos los motores de reglas y se mantiene
              mientras el servidor este en ejecucion. La persistencia definitiva se habilita al
              conectar la base interna de la plataforma (variable <code>DATABASE_URL</code>).
              Autenticacion: {data.authEnabled ? 'activada' : 'desactivada (AUTH_ENABLED=false)'}.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function IntegrationTile({
  title,
  value,
  simulated,
  detail,
}: {
  title: string;
  value: string;
  simulated: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-line bg-surface-900 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs uppercase tracking-wider text-ink-faint">{title}</p>
        <Badge tone={simulated ? 'warning' : 'active'} dot>
          {simulated ? 'Demo' : 'Conectado'}
        </Badge>
      </div>
      <p className="mt-1.5 text-[13px] font-medium capitalize text-ink">{value}</p>
      <p className="mt-1 text-2xs leading-relaxed text-ink-faint">{detail}</p>
    </div>
  );
}
