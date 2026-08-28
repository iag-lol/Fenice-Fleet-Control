'use client';

import Link from 'next/link';

import { dispatchStages } from '@/lib/engines/operational-attention';
import { formatNumber, formatPercent } from '@/lib/format';
import type { OrdersKpis } from '@/types/views';

/**
 * Avance del despacho del dia, como un embudo y no como siete cifras sueltas.
 *
 * Cada tramo es proporcional a su volumen, asi que el reparto se lee de un
 * vistazo: donde se acumula el trabajo y cuanto queda por salir.
 *
 * Los tramos son EXCLUYENTES y suman el total. Los indicadores de origen se
 * solapan (`visitados` incluye a `finalizados`), y esa resta la hace el motor
 * en `dispatchStages`, no esta pantalla.
 */

/** Color por tramo, en el orden del recorrido de una entrega. */
const COLOR: Record<string, string> = {
  finalizados: 'bg-status-active',
  visitados: 'bg-brand-500',
  proximas: 'bg-brand-300',
  'en-ruta': 'bg-status-moving',
  pendientes: 'bg-status-warning',
  incidencia: 'bg-status-dormant',
};

export function DayProgress({
  orders,
  completion,
}: {
  orders: OrdersKpis;
  completion: number | null;
}) {
  const total = orders.despachosHoy.value;

  const tramos = dispatchStages(orders).map((tramo) => ({
    ...tramo,
    color: COLOR[tramo.id] ?? 'bg-surface-700',
  }));

  const suma = tramos.reduce((acc, t) => acc + t.value, 0);
  const visibles = tramos.filter((t) => t.value > 0);

  return (
    <div className="rounded-xl border border-line bg-surface-900 p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            Despacho de hoy
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="numeric text-3xl font-bold leading-none text-ink">
              {formatNumber(total)}
            </span>
            <span className="text-sm text-ink-muted">ordenes programadas</span>
          </p>
        </div>

        <div className="text-right">
          <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
            Resueltas
          </p>
          <p className="numeric mt-1 text-3xl font-bold leading-none text-status-active">
            {completion === null ? '—' : formatPercent(completion)}
          </p>
        </div>
      </div>

      {suma === 0 ? (
        <p className="mt-4 rounded-lg border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
          No hay ordenes de trabajo programadas para hoy.
        </p>
      ) : (
        <>
          <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-750">
            {visibles.map((tramo) => (
              <span
                key={tramo.id}
                className={tramo.color}
                style={{ width: `${(tramo.value / suma) * 100}%` }}
                title={`${tramo.label}: ${formatNumber(tramo.value)}`}
              />
            ))}
          </div>

          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {tramos.map((tramo) => (
              <li key={tramo.id}>
                <Link
                  prefetch={false}
                  href={tramo.href}
                  className="group flex min-h-11 items-center gap-2 sm:min-h-0"
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${tramo.color}`} />
                  <span className="numeric text-sm font-semibold text-ink">
                    {formatNumber(tramo.value)}
                  </span>
                  <span className="text-xs text-ink-muted group-hover:text-ink">{tramo.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
