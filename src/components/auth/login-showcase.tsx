import { Gauge, MapPinned, ShieldCheck } from 'lucide-react';

import { BrandMark } from '@/components/shell/brand';

const HIGHLIGHTS = [
  {
    icon: Gauge,
    title: 'Torre de control en tiempo real',
    description: 'Flota, rutas y alertas en un solo mapa, sin recargar.',
  },
  {
    icon: MapPinned,
    title: 'Geocercas y entregas inteligentes',
    description: 'Deteccion automatica de llegada, permanencia y desvio.',
  },
  {
    icon: ShieldCheck,
    title: 'Evidencia y trazabilidad',
    description: 'Firma, fotos y GPS de cada entrega, listos para auditar.',
  },
] as const;

/**
 * Panel de marca del login. Solo desktop (`lg:flex`): en pantallas angostas
 * cede todo el espacio al formulario, que es lo unico imprescindible.
 */
export function LoginShowcase() {
  return (
    <div className="relative hidden w-full max-w-md flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-brand-700 via-brand-900 to-ink p-10 text-white shadow-panel lg:flex">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-400/30 blur-3xl"
        aria-hidden
      />

      <div className="relative">
        <BrandMark className="h-11 w-11" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Fenice Fleet Control</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/70">
          La plataforma de control de flota y logistica de Fenice SpA: GPS, rutas, clientes y
          entregas en un solo lugar.
        </p>
      </div>

      <ul className="relative space-y-5">
        {HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
          <li key={title} className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
              <Icon className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-white">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-white/60">{description}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="relative text-2xs text-white/40">
        Acceso exclusivo para personal autorizado de Fenice SpA.
      </p>
    </div>
  );
}
