'use client';

import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  MapPin,
  PackageSearch,
  Search,
  Truck,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { BrandMark } from '@/components/shell/brand';
import { FleetMap } from '@/components/map/fleet-map';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppHeight } from '@/hooks/use-app-height';
import { formatElapsed, formatEta, formatSmartDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { TrackingSession } from '@/types/core';

/**
 * Seguimiento publico de pedido.
 *
 * Sin autenticacion y sin el shell interno: es la unica superficie que ve un
 * cliente final de Fenice. Muestra exclusivamente su pedido, y nada del resto
 * de la operacion.
 */
export function TrackingView() {
  useAppHeight();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialRef = searchParams.get('ref') ?? '';
  const [reference, setReference] = useState(initialRef);
  const [submitted, setSubmitted] = useState(initialRef);

  useEffect(() => {
    setReference(initialRef);
    setSubmitted(initialRef);
  }, [initialRef]);

  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['tracking', submitted],
    enabled: submitted.trim().length >= 4,
    // El cliente final espera ver el camion moverse: refresco frecuente.
    refetchInterval: 20_000,
    retry: false,
    queryFn: async (): Promise<TrackingSession> => {
      const response = await fetch(`/api/seguimiento?ref=${encodeURIComponent(submitted)}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No encontramos un pedido con ese numero.');
      }
      return (await response.json()) as TrackingSession;
    },
  });

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const value = reference.trim();
    if (value.length < 4) return;
    setSubmitted(value);
    router.replace(`/seguimiento?ref=${encodeURIComponent(value)}`);
  };

  // Se apoya en `trackingAllowed`, que es la misma decision que tomo el
  // backend: si la interfaz usara su propio criterio, podrian discrepar.
  const delivered = data !== undefined && !data.trackingAllowed && data.status !== 'cancelada';

  return (
    <div className="min-h-app bg-surface-950">
      <header className="safe-top border-b border-line bg-surface-900">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2.5 px-4">
          <BrandMark className="h-7 w-7" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-ink">Seguimiento de pedido</p>
            <p className="truncate text-2xs text-ink-faint">Fenice SpA</p>
          </div>
        </div>
      </header>

      <main className="safe-bottom mx-auto max-w-3xl px-4 py-6">
        <form onSubmit={onSubmit} className="mb-6">
          <label htmlFor="ref" className="mb-2 block text-sm font-medium text-ink">
            Ingresa tu numero de pedido u orden de trabajo
          </label>
          <div className="flex gap-2">
            <Input
              id="ref"
              value={reference}
              onChange={(event) => setReference(event.target.value.toUpperCase())}
              onClear={() => setReference('')}
              placeholder="Ej: OT-2026-001582"
              autoComplete="off"
              spellCheck={false}
              className="numeric"
            />
            <Button
              type="submit"
              variant="primary"
              icon={<Search className="h-4 w-4" />}
              loading={isFetching && submitted === reference.trim()}
              disabled={reference.trim().length < 4}
            >
              <span className="hidden sm:inline">Buscar</span>
            </Button>
          </div>
          <p className="mt-2 text-2xs text-ink-faint">
            Puedes usar el numero de pedido o el numero de orden de trabajo que aparece en tu
            documento de despacho.
          </p>
        </form>

        {submitted.trim().length < 4 ? (
          <div className="rounded-lg border border-line bg-surface-850 px-6 py-12 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-800 text-ink-faint">
              <PackageSearch className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-ink">Consulta el estado de tu pedido</p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-faint">
              Ingresa el numero que aparece en tu documento de despacho para ver el estado de la
              entrega y la ubicacion del vehiculo en camino.
            </p>
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-status-warning/30 bg-status-warning/5 px-6 py-10 text-center">
            <p className="text-sm font-medium text-ink">
              {error instanceof Error ? error.message : 'No encontramos un pedido con ese numero.'}
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-faint">
              Revisa que el numero este completo y sin espacios. Si el problema persiste, contacta a
              tu ejecutivo comercial.
            </p>
            <Button className="mt-4" size="sm" variant="secondary" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </div>
        ) : !data ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* --- Estado principal --- */}
            <section
              className={cn(
                'rounded-lg border p-5',
                delivered
                  ? 'border-status-active/30 bg-status-active/5'
                  : 'border-brand-500/30 bg-brand-500/5',
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                    delivered
                      ? 'bg-status-active/20 text-status-active'
                      : 'bg-brand-500/20 text-brand-700',
                  )}
                >
                  {delivered ? <CheckCircle2 className="h-5 w-5" /> : <Truck className="h-5 w-5" />}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-ink">
                    {delivered ? 'Tu pedido fue entregado.' : `Tu pedido esta ${data.statusLabel.toLowerCase()}.`}
                  </p>

                  {!delivered && data.eta?.minutes !== null && data.eta !== null ? (
                    <p className="mt-1 text-sm text-ink-muted">
                      Entrega estimada:{' '}
                      <span className="numeric font-semibold text-brand-700">
                        {formatEta(data.eta.minutes)}
                      </span>
                    </p>
                  ) : null}

                  {delivered && data.deliveredAt ? (
                    <p className="mt-1 text-sm text-ink-muted">
                      Entregado el {formatSmartDateTime(data.deliveredAt)}
                    </p>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line/60 pt-3">
                    <div>
                      <p className="text-2xs uppercase tracking-wider text-ink-faint">
                        Numero de pedido
                      </p>
                      <p className="numeric mt-0.5 text-[13px] text-ink">{data.orderNumber}</p>
                    </div>
                    <div>
                      <p className="text-2xs uppercase tracking-wider text-ink-faint">
                        Orden de trabajo
                      </p>
                      <p className="numeric mt-0.5 text-[13px] text-ink">{data.workOrderNumber}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Barra de progreso de la entrega. */}
              <div className="mt-4">
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-750">
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-700',
                      delivered ? 'bg-status-active' : 'bg-brand-400',
                    )}
                    style={{ width: `${Math.round(data.progress * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-2xs text-ink-faint">
                  <span>En preparacion</span>
                  <span>En camino</span>
                  <span>Entregado</span>
                </div>
              </div>
            </section>

            {/* --- Destino --- */}
            <section className="rounded-lg border border-line bg-surface-850 p-4">
              <p className="text-2xs uppercase tracking-wider text-ink-faint">Direccion de entrega</p>
              <p className="mt-1 flex items-start gap-2 text-[13px] text-ink">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                <span>
                  {data.destination.addressLine}, {data.destination.communeName}
                </span>
              </p>
            </section>

            {/* --- Mapa: solo mientras el pedido este en curso --- */}
            {data.trackingAllowed && data.vehicle?.position && data.destination.coordinates ? (
              <section className="overflow-hidden rounded-lg border border-line bg-surface-850">
                <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">
                      Vehiculo {data.vehicle.label}
                    </p>
                    <p className="truncate text-2xs text-ink-faint">
                      {data.vehicle.moving ? 'En movimiento' : 'Detenido'} ·{' '}
                      {formatElapsed(
                        data.vehicle.lastUpdateAt
                          ? Math.round(
                              (Date.now() - new Date(data.vehicle.lastUpdateAt).getTime()) / 1000,
                            )
                          : null,
                      )}
                    </p>
                  </div>
                  <Clock className="h-4 w-4 shrink-0 text-ink-faint" />
                </div>

                <div className="relative h-[300px] sm:h-[380px]">
                  <ErrorBoundary section="el mapa de seguimiento">
                    <FleetMap
                      className="absolute inset-0"
                      // Solo el vehiculo asignado y el destino: ninguna otra
                      // informacion de la operacion se comparte con el cliente.
                      layerOverride={{
                        camiones: true,
                        clientes: true,
                        rutas: false,
                        geocercas: false,
                        calor: false,
                        pedidos: false,
                        alertas: false,
                        comunas: false,
                      }}
                      vehicles={[
                        {
                          vehicleId: 'tracking-vehicle',
                          plate: data.vehicle.label,
                          fleetCode: '',
                          status: data.vehicle.moving ? 'moving' : 'stopped',
                          position: {
                            vehicleId: 'tracking-vehicle' as never,
                            deviceId: 'tracking-device' as never,
                            timestamp: data.vehicle.lastUpdateAt ?? data.lastUpdateAt,
                            lat: data.vehicle.position.lat,
                            lng: data.vehicle.position.lng,
                            speed: data.vehicle.moving ? 30 : 0,
                            heading: data.vehicle.heading,
                            ignition: 'on',
                            valid: true,
                          },
                        },
                      ]}
                      clients={[
                        {
                          clientId: 'tracking-destination',
                          code: '',
                          name: 'Direccion de entrega',
                          lat: data.destination.coordinates.lat,
                          lng: data.destination.coordinates.lng,
                          communeCode: '',
                          communeName: data.destination.communeName,
                          addressLine: data.destination.addressLine,
                          status: 'active',
                          daysSincePurchase: null,
                          daysSinceVisit: null,
                          hasPendingOrder: true,
                          visitedToday: false,
                          lifetimeValue: 0,
                          segment: 'estacion_servicio',
                          salesRep: null,
                        },
                      ]}
                      routes={[]}
                      geofences={[]}
                      alerts={[]}
                      workOrders={[]}
                      communes={[]}
                      heatmapPoints={[]}
                    />
                  </ErrorBoundary>
                </div>
              </section>
            ) : delivered ? (
              <section className="rounded-lg border border-status-active/25 bg-status-active/5 px-4 py-6 text-center">
                <p className="text-[13px] font-medium text-ink">
                  El seguimiento finalizo con la entrega.
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-faint">
                  Por privacidad dejamos de compartir la ubicacion del vehiculo: el camion
                  continua su ruta hacia otros clientes.
                </p>
              </section>
            ) : (
              <section className="rounded-lg border border-line bg-surface-850 px-4 py-6 text-center">
                <p className="text-[13px] text-ink">
                  Tu pedido aun no ha sido despachado a un vehiculo.
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  Cuando salga a ruta podras ver aqui la ubicacion del camion en tiempo real.
                </p>
              </section>
            )}

            <p className="text-center text-2xs text-ink-faint">
              Ultima actualizacion: {formatSmartDateTime(data.lastUpdateAt)}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
