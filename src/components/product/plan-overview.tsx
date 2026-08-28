'use client';

import { Check, Lock, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { FEATURES } from '@/product/features';
import { getProductConfig } from '@/product/plans';
import {
  PLAN_LABEL,
  PLAN_ORDER,
  PLAN_SHORT_LABEL,
  planIncludes,
  type ProductPlan,
} from '@/product/plans';

/**
 * Que incluye cada plan, y cual esta contratado.
 *
 * El sistema separa PLAN de IMPLEMENTACION en todo el codigo, pero esa
 * distincion era invisible para el cliente: se veian pantallas sueltas sin
 * saber cual venia con que nivel. Esta banda lo hace explicito y, sobre todo,
 * honesto: solo cuenta funciones realmente implementadas.
 *
 * No muestra precios. La conversacion comercial no ocurre dentro de la
 * herramienta de operacion.
 */

/** Lo que define a cada nivel, en el lenguaje del negocio y no del sistema. */
const PLAN_PITCH: Record<ProductPlan, string> = {
  base: 'Ver la flota, la cartera y las entregas del dia sobre un mapa unico.',
  medium: 'Operar desde el mapa, con portal del conductor y evidencia de entrega.',
  advanced: 'Anticipar: prediccion, optimizacion y analitica sobre la operacion.',
};

/** Tres ejemplos por plan. Mas que eso deja de leerse. */
const PLAN_HIGHLIGHTS: Record<ProductPlan, string[]> = {
  base: ['Torre de control con el mapa', 'Editor de geocercas', 'Seguimiento publico del cliente'],
  medium: ['Panel de operacion en el mapa', 'Portal del conductor', 'Evidencia de entrega'],
  advanced: ['ETA predictiva', 'Optimizacion de rutas', 'Analitica avanzada'],
};

export function PlanOverview() {
  const config = getProductConfig();

  // El catalogo solo lista funciones implementadas en algun grado; `locked`
  // es un estado que resuelve el plan, no algo que se declare aqui. Se cuentan
  // todas para que el inventario por nivel sea el real.
  const implementadas = FEATURES;

  return (
    <section className="rounded-xl border border-line bg-surface-900 p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-brand-600" />
            Tu plan: {PLAN_LABEL[config.plan]}
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Cada nivel incluye todo lo del anterior. Nada se reemplaza al ampliar.
          </p>
        </div>
        <Link
          href="/configuracion"
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-md border border-line-strong px-3 text-xs font-medium text-ink-muted hover:text-ink sm:min-h-9"
        >
          Ver detalle de funciones
        </Link>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {PLAN_ORDER.map((plan) => {
          const incluido = planIncludes(config.plan, plan);
          const esActual = config.plan === plan;
          const delPlan = implementadas.filter((f) => f.minimumPlan === plan);

          return (
            <div
              key={plan}
              className={`rounded-lg border p-3.5 transition-colors ${
                esActual
                  ? 'border-brand-500 bg-brand-500/5 ring-1 ring-brand-500/20'
                  : incluido
                    ? 'border-line bg-surface-800'
                    : 'border-dashed border-line-strong bg-surface-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">
                  {PLAN_SHORT_LABEL[plan]}
                </span>
                {esActual ? (
                  <span className="rounded-full bg-brand-600 px-2 py-0.5 text-2xs font-semibold text-white">
                    Contratado
                  </span>
                ) : incluido ? (
                  <span className="inline-flex items-center gap-1 text-2xs font-medium text-status-active">
                    <Check className="h-3 w-3" /> Incluido
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-2xs font-medium text-ink-faint">
                    <Lock className="h-3 w-3" /> No contratado
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{PLAN_PITCH[plan]}</p>

              <ul className="mt-2.5 space-y-1">
                {PLAN_HIGHLIGHTS[plan].map((item) => (
                  <li
                    key={item}
                    className={`flex items-start gap-1.5 text-2xs leading-snug ${
                      incluido ? 'text-ink-muted' : 'text-ink-faint'
                    }`}
                  >
                    <Check
                      className={`mt-0.5 h-3 w-3 shrink-0 ${
                        incluido ? 'text-status-active' : 'text-line-strong'
                      }`}
                    />
                    {item}
                  </li>
                ))}
              </ul>

              <p className="mt-2.5 border-t border-line pt-2 text-2xs text-ink-faint">
                <span className="numeric font-semibold text-ink-muted">{delPlan.length}</span>{' '}
                funciones incorpora este nivel
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
