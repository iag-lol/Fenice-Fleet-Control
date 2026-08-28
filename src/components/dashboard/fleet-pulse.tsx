'use client';

import { Gauge, Truck, WifiOff } from 'lucide-react';
import Link from 'next/link';

import { VehicleStatusBadge } from '@/components/common/status';
import { formatNumber, formatSpeed } from '@/lib/format';
import type { FleetKpis } from '@/types/views';
import type { VehicleSnapshot } from '@/types/core';

/**
 * Estado de la flota en una sola tarjeta.
 *
 * Antes eran cinco tarjetas con un numero cada una. El reparto —cuantos de
 * los doce estan realmente moviendose— exigia compararlas mentalmente. Aqui
 * la barra ya lo muestra, y debajo van los camiones que si estan en marcha,
 * que es lo unico que cambia minuto a minuto.
 */

export function FleetPulse({
  fleet,
  vehicles,
}: {
  fleet: FleetKpis;
  vehicles: VehicleSnapshot[];
}) {
  const total = fleet.total.value;

  const tramos = [
    { id: 'en_ruta', label: 'En ruta', value: fleet.enRuta.value, color: 'bg-status-moving', href: '/flota?estado=en_ruta' },
    { id: 'detenido', label: 'Detenidos', value: fleet.detenidos.value, color: 'bg-status-warning', href: '/flota?estado=detenido' },
    { id: 'offline', label: 'Sin señal', value: fleet.offline.value, color: 'bg-status-dormant', href: '/flota?estado=offline' },
  ];
  const suma = tramos.reduce((acc, t) => acc + t.value, 0);
  const resto = Math.max(0, total - suma);

  const enMarcha = vehicles
    .filter((v) => v.status === 'en_ruta' && (v.position?.speed ?? 0) > 0)
    .sort((a, b) => (b.position?.speed ?? 0) - (a.position?.speed ?? 0))
    .slice(0, 5);

  return (
    <div className="flex h-full flex-col rounded-xl border border-line bg-surface-900 shadow-card">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            <Truck className="h-3.5 w-3.5" /> Flota ahora
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="numeric text-2xl font-bold leading-none text-ink">
              {formatNumber(total)}
            </span>
            <span className="text-xs text-ink-muted">vehiculos</span>
          </p>
        </div>
        {fleet.offline.value > 0 ? (
          <Link
            prefetch={false}
            href="/flota?estado=offline"
            className="flex min-h-11 items-center gap-1.5 rounded-md bg-status-dormant/10 px-2.5 text-2xs font-semibold text-status-dormant sm:min-h-8"
          >
            <WifiOff className="h-3.5 w-3.5" />
            {formatNumber(fleet.offline.value)} sin señal
          </Link>
        ) : null}
      </div>

      <div className="px-4 py-3">
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-750">
          {tramos
            .filter((t) => t.value > 0)
            .map((tramo) => (
              <span
                key={tramo.id}
                className={tramo.color}
                style={{ width: `${(tramo.value / Math.max(1, total)) * 100}%` }}
                title={`${tramo.label}: ${formatNumber(tramo.value)}`}
              />
            ))}
        </div>

        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
          {tramos.map((tramo) => (
            <li key={tramo.id}>
              <Link
                prefetch={false}
                href={tramo.href}
                className="group flex min-h-11 items-center gap-1.5 sm:min-h-0"
              >
                <span className={`h-2 w-2 rounded-sm ${tramo.color}`} />
                <span className="numeric text-[13px] font-semibold text-ink">{tramo.value}</span>
                <span className="text-2xs text-ink-muted group-hover:text-ink">{tramo.label}</span>
              </Link>
            </li>
          ))}
          {resto > 0 ? (
            <li className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-surface-700" />
              <span className="numeric text-[13px] font-semibold text-ink">{resto}</span>
              <span className="text-2xs text-ink-muted">Otros estados</span>
            </li>
          ) : null}
        </ul>
      </div>

      <div className="mt-auto border-t border-line">
        <p className="flex items-center gap-1.5 px-4 pt-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
          <Gauge className="h-3.5 w-3.5" /> En marcha
        </p>
        {enMarcha.length === 0 ? (
          <p className="px-4 pb-3 pt-1.5 text-xs text-ink-faint">
            Ningun vehiculo circulando en este momento.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {enMarcha.map((snapshot) => (
              <li key={snapshot.vehicle.id}>
                <Link
                  prefetch={false}
                  href={`/flota/${snapshot.vehicle.id}`}
                  className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-800"
                >
                  <span className="numeric shrink-0 rounded bg-surface-750 px-1.5 py-0.5 text-2xs font-semibold text-ink">
                    {snapshot.vehicle.plate}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-2xs text-ink-faint">
                    {snapshot.driver?.fullName ?? 'Sin conductor'}
                  </span>
                  <VehicleStatusBadge status={snapshot.status} />
                  <span className="numeric w-16 shrink-0 text-right text-[13px] font-semibold text-ink">
                    {formatSpeed(snapshot.position?.speed ?? 0)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
