'use client';

import { AlertTriangle, ArrowRight, CheckCircle2, Info, WifiOff } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatNumber } from '@/lib/format';
import type { AttentionItem, AttentionSeverity } from '@/lib/engines/operational-attention';

/**
 * Lo que requiere accion, en orden de urgencia.
 *
 * Es lo primero del panel a proposito: la pregunta que el operador trae al
 * abrir la aplicacion no es "cuantos vehiculos hay", es "por donde empiezo".
 */

const SEVERITY_STYLE: Record<AttentionSeverity, { chip: string; borde: string; icono: ReactNode }> = {
  critical: {
    chip: 'bg-status-dormant text-white',
    borde: 'border-status-dormant/35 bg-status-dormant/5',
    icono: <AlertTriangle className="h-4 w-4" />,
  },
  warning: {
    chip: 'bg-status-warning text-white',
    borde: 'border-status-warning/35 bg-status-warning/5',
    icono: <AlertTriangle className="h-4 w-4" />,
  },
  info: {
    chip: 'bg-surface-750 text-ink-muted',
    borde: 'border-line bg-surface-900',
    icono: <Info className="h-4 w-4" />,
  },
};

const ICONO_POR_ID: Record<string, ReactNode> = {
  'vehiculos-offline': <WifiOff className="h-4 w-4" />,
};

export function AttentionBoard({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-status-active/30 bg-status-active/5 px-4 py-3.5">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-status-active" />
        <div>
          <p className="text-sm font-semibold text-ink">La operacion esta en orden</p>
          <p className="text-xs text-ink-muted">
            Sin alertas criticas, vehiculos sin señal ni entregas con incidencia.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        const estilo = SEVERITY_STYLE[item.severity];
        return (
          <li key={item.id}>
            <Link
              prefetch={false}
              href={item.href}
              className={`group flex h-full items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors hover:border-brand-500 ${estilo.borde}`}
            >
              <span
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${estilo.chip}`}
              >
                {ICONO_POR_ID[item.id] ?? estilo.icono}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-ink">
                  <span className="numeric text-lg font-bold">{formatNumber(item.count)}</span>{' '}
                  <span className="font-medium">{item.title}</span>
                </p>
                <p className="mt-0.5 text-xs leading-snug text-ink-muted">{item.detail}</p>
                <span className="mt-1.5 inline-flex items-center gap-1 text-2xs font-semibold text-brand-700">
                  {item.actionLabel}
                  <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
