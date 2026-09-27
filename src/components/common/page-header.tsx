import {
  Activity,
  AlertTriangle,
  Building2,
  Camera,
  ClipboardList,
  House,
  LayoutDashboard,
  MapPinned,
  Route,
  Settings2,
  Shield,
  Truck,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}

interface PageIdentity {
  eyebrow: string;
  icon: LucideIcon;
  iconClass: string;
  glowClass: string;
  lineClass: string;
}

const IDENTITIES: { pattern: RegExp; value: PageIdentity }[] = [
  {
    pattern: /panel/i,
    value: {
      eyebrow: 'Pulso operacional',
      icon: LayoutDashboard,
      iconClass: 'bg-brand-500/10 text-brand-700 ring-brand-500/15',
      glowClass: 'bg-brand-300/20',
      lineClass: 'from-brand-700 via-brand-400 to-cyan-300',
    },
  },
  {
    pattern: /flota|veh[ií]culo/i,
    value: {
      eyebrow: 'Movilidad y telemetría',
      icon: Truck,
      iconClass: 'bg-sky-500/10 text-sky-700 ring-sky-500/15',
      glowClass: 'bg-sky-300/20',
      lineClass: 'from-sky-700 via-sky-400 to-cyan-300',
    },
  },
  {
    pattern: /orden|despacho/i,
    value: {
      eyebrow: 'Ejecución logística',
      icon: ClipboardList,
      iconClass: 'bg-violet-500/10 text-violet-700 ring-violet-500/15',
      glowClass: 'bg-violet-300/20',
      lineClass: 'from-violet-700 via-violet-400 to-fuchsia-300',
    },
  },
  {
    pattern: /ruta/i,
    value: {
      eyebrow: 'Planificación de recorridos',
      icon: Route,
      iconClass: 'bg-indigo-500/10 text-indigo-700 ring-indigo-500/15',
      glowClass: 'bg-indigo-300/20',
      lineClass: 'from-indigo-700 via-indigo-400 to-sky-300',
    },
  },
  {
    pattern: /cliente/i,
    value: {
      eyebrow: 'Cartera y cobertura',
      icon: Building2,
      iconClass: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/15',
      glowClass: 'bg-emerald-300/20',
      lineClass: 'from-emerald-700 via-emerald-400 to-teal-300',
    },
  },
  {
    pattern: /alerta/i,
    value: {
      eyebrow: 'Atención prioritaria',
      icon: AlertTriangle,
      iconClass: 'bg-amber-500/10 text-amber-700 ring-amber-500/15',
      glowClass: 'bg-amber-300/20',
      lineClass: 'from-amber-700 via-orange-400 to-amber-300',
    },
  },
  {
    pattern: /territor/i,
    value: {
      eyebrow: 'Inteligencia geográfica',
      icon: MapPinned,
      iconClass: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/15',
      glowClass: 'bg-cyan-300/20',
      lineClass: 'from-cyan-700 via-cyan-400 to-teal-300',
    },
  },
  {
    pattern: /geocerca/i,
    value: {
      eyebrow: 'Reglas espaciales',
      icon: Shield,
      iconClass: 'bg-rose-500/10 text-rose-700 ring-rose-500/15',
      glowClass: 'bg-rose-300/20',
      lineClass: 'from-rose-700 via-rose-400 to-orange-300',
    },
  },
  {
    pattern: /punto|central/i,
    value: {
      eyebrow: 'Infraestructura operacional',
      icon: House,
      iconClass: 'bg-teal-500/10 text-teal-700 ring-teal-500/15',
      glowClass: 'bg-teal-300/20',
      lineClass: 'from-teal-700 via-teal-400 to-emerald-300',
    },
  },
  {
    pattern: /evidencia/i,
    value: {
      eyebrow: 'Respaldo de entregas',
      icon: Camera,
      iconClass: 'bg-pink-500/10 text-pink-700 ring-pink-500/15',
      glowClass: 'bg-pink-300/20',
      lineClass: 'from-pink-700 via-pink-400 to-rose-300',
    },
  },
  {
    pattern: /configura/i,
    value: {
      eyebrow: 'Administración del sistema',
      icon: Settings2,
      iconClass: 'bg-slate-500/10 text-slate-700 ring-slate-500/15',
      glowClass: 'bg-slate-300/20',
      lineClass: 'from-slate-700 via-slate-400 to-slate-300',
    },
  },
];

const DEFAULT_IDENTITY: PageIdentity = {
  eyebrow: 'Centro de gestión',
  icon: Activity,
  iconClass: 'bg-brand-500/10 text-brand-700 ring-brand-500/15',
  glowClass: 'bg-brand-300/20',
  lineClass: 'from-brand-700 via-brand-400 to-cyan-300',
};

function identityFor(title: string): PageIdentity {
  return IDENTITIES.find((entry) => entry.pattern.test(title))?.value ?? DEFAULT_IDENTITY;
}

export function PageHeader({ title, description, actions, breadcrumb, className }: PageHeaderProps) {
  const identity = identityFor(title);
  const Icon = identity.icon;

  return (
    <div
      className={cn(
        'relative mb-3.5 overflow-hidden rounded-[14px] border border-line bg-surface-900 shadow-card sm:mb-4',
        className,
      )}
    >
      <span
        className={cn('absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r', identity.lineClass)}
        aria-hidden
      />
      <span
        className={cn(
          'pointer-events-none absolute -right-8 -top-14 h-36 w-36 rounded-full blur-3xl',
          identity.glowClass,
        )}
        aria-hidden
      />
      <Icon
        className="pointer-events-none absolute -bottom-7 right-4 h-24 w-24 rotate-[-8deg] text-ink opacity-[0.035]"
        aria-hidden
      />

      <div className="relative px-3.5 py-3.5 sm:px-4 sm:py-4">
        {breadcrumb ? (
          <div className="mb-2 text-2xs font-medium text-ink-faint [&_a]:inline-flex [&_a]:min-h-8 [&_a]:items-center [&_a]:hover:text-brand-700">
            {breadcrumb}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1',
                identity.iconClass,
              )}
            >
              <Icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-ink-faint">
                {identity.eyebrow}
              </p>
              <h1 className="mt-0.5 truncate text-lg font-semibold tracking-[-0.025em] text-ink">
                {title}
              </h1>
              {description ? (
                <div className="mt-0.5 max-w-4xl text-xs leading-relaxed text-ink-muted">
                  {description}
                </div>
              ) : null}
            </div>
          </div>

          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[52px] sm:pl-0">
              {actions}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
