'use client';

import { useQuery } from '@tanstack/react-query';
import { Layers2, Lock, Moon, Satellite, TrafficCone } from 'lucide-react';
import { useRef, useState } from 'react';

import { MapPopover } from '@/components/map/map-popover';

import { PlanBadge } from '@/components/product/plan-badge';
import { Badge } from '@/components/ui/badge';
import {
  getAvailableViewModes,
  MAP_VIEW_LABEL,
  type MapViewMode,
} from '@/components/map/map-style';
import { cn } from '@/lib/cn';
import { resolveFeature } from '@/product/feature-access';
import type { TrafficProviderInfo } from '@/services/traffic/traffic-provider';
import { useMapStore } from '@/stores/map-store';

const MODE_ICON: Record<MapViewMode, typeof Layers2> = {
  standard: Layers2,
  satellite: Satellite,
  hybrid: Satellite,
  dark: Moon,
};

/**
 * Alterna rapida Mapa / Satelite, junto al selector completo de vista.
 *
 * Cubre el atajo mas usado (mapa base vs. imagen satelital) sin abrir el
 * desplegable. Respeta la misma reja de plan que `ViewModeControl`: si el
 * satelite no esta incluido, el boton queda visible pero bloqueado con
 * candado, nunca oculto (ocultarlo haria pensar que la plataforma no lo
 * ofrece).
 */
export function MapViewQuickToggle() {
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);
  const satelliteAccess = resolveFeature('satellite-view');
  const satelliteActive = viewMode === 'satellite' || viewMode === 'hybrid';

  return (
    <div
      role="group"
      aria-label="Vista rapida del mapa"
      className="tap flex items-center rounded-md border border-line-strong bg-surface-900/95 p-0.5 text-[13px] text-ink shadow-float backdrop-blur sm:h-9"
    >
      <button
        type="button"
        onClick={() => setViewMode('standard')}
        aria-pressed={!satelliteActive}
        className={cn(
          'flex h-full items-center gap-1.5 rounded px-2.5 transition-colors',
          !satelliteActive ? 'bg-brand-500/15 text-brand-700' : 'text-ink-faint hover:text-ink',
        )}
      >
        <Layers2 className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Mapa</span>
      </button>
      <button
        type="button"
        disabled={!satelliteAccess.includedInPlan}
        title={!satelliteAccess.includedInPlan ? (satelliteAccess.reason ?? undefined) : undefined}
        onClick={() => setViewMode('satellite')}
        aria-pressed={satelliteActive}
        className={cn(
          'flex h-full items-center gap-1.5 rounded px-2.5 transition-colors',
          satelliteActive
            ? 'bg-brand-500/15 text-brand-700'
            : satelliteAccess.includedInPlan
              ? 'text-ink-faint hover:text-ink'
              : 'cursor-not-allowed text-ink-faint/50',
        )}
      >
        {satelliteAccess.includedInPlan ? (
          <Satellite className="h-3.5 w-3.5" />
        ) : (
          <Lock className="h-3.5 w-3.5" />
        )}
        <span className="hidden sm:inline">Satélite</span>
      </button>
    </div>
  );
}

/**
 * Selector de vista del mapa y capa de trafico.
 *
 * Los modos que requieren proveedor NO se ocultan: se muestran con su motivo.
 * Ocultarlos haria pensar que la plataforma no los soporta; mostrarlos
 * habilitados sin proveedor produciria un mapa en blanco.
 */
export function ViewModeControl() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);
  const trafficEnabled = useMapStore((s) => s.trafficEnabled);
  const setTrafficEnabled = useMapStore((s) => s.setTrafficEnabled);

  const modes = getAvailableViewModes();
  const satelliteAccess = resolveFeature('satellite-view');
  const trafficAccess = resolveFeature('live-traffic');

  const { data: traffic } = useQuery({
    queryKey: ['traffic', 'provider'],
    staleTime: 10 * 60_000,
    enabled: trafficAccess.includedInPlan,
    queryFn: async (): Promise<{ provider: TrafficProviderInfo }> => {
      const response = await fetch('/api/trafico');
      if (!response.ok) throw new Error('Trafico no disponible');
      return (await response.json()) as { provider: TrafficProviderInfo };
    },
  });

  const trafficAvailable = traffic?.provider.available ?? false;
  const CurrentIcon = MODE_ICON[viewMode];

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="Vista del mapa"
        className="tap flex items-center gap-2 rounded-md border border-line-strong bg-surface-900/95 px-3 text-[13px] text-ink shadow-float backdrop-blur transition-colors hover:border-brand-500 sm:h-9 sm:min-h-0"
      >
        <CurrentIcon className="h-4 w-4 text-brand-700" />
        <span className="hidden sm:inline">{MAP_VIEW_LABEL[viewMode]}</span>
      </button>

      <MapPopover
        open={open}
        onClose={() => setOpen(false)}
        title="Vista del mapa"
        width={268}
        anchorRef={anchorRef}
      >
            <p className="field-label hidden px-1 md:block">Vista del mapa</p>

            <ul className="space-y-0.5">
              {modes.map((entry) => {
                const Icon = MODE_ICON[entry.mode];
                const needsPlan =
                  (entry.mode === 'satellite' || entry.mode === 'hybrid') &&
                  !satelliteAccess.includedInPlan;
                const disabled = !entry.available || needsPlan;
                const selected = viewMode === entry.mode;

                return (
                  <li key={entry.mode}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setViewMode(entry.mode);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                        selected
                          ? 'bg-brand-500/12 text-ink'
                          : disabled
                            ? 'cursor-not-allowed text-ink-faint'
                            : 'text-ink-muted hover:bg-surface-800',
                      )}
                    >
                      <Icon
                        className={cn(
                          'mt-0.5 h-4 w-4 shrink-0',
                          selected ? 'text-brand-700' : 'text-ink-faint',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[13px]">{MAP_VIEW_LABEL[entry.mode]}</span>
                          {entry.mode === 'satellite' || entry.mode === 'hybrid' ? (
                            <PlanBadge featureId="satellite-view" />
                          ) : null}
                          {entry.mode === 'dark' ? <PlanBadge featureId="dark-map" /> : null}
                        </span>
                        {disabled ? (
                          <span className="mt-0.5 block text-2xs leading-relaxed text-ink-faint">
                            {needsPlan ? satelliteAccess.reason : entry.reason}
                          </span>
                        ) : null}
                      </span>
                      {disabled ? <Lock className="mt-0.5 h-3 w-3 shrink-0" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* --- Capa de trafico --- */}
            <div className="mt-2 border-t border-line pt-2">
              <button
                type="button"
                role="switch"
                aria-checked={trafficEnabled}
                disabled={!trafficAvailable}
                onClick={() => setTrafficEnabled(!trafficEnabled)}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  trafficEnabled
                    ? 'bg-brand-500/12 text-ink'
                    : trafficAvailable
                      ? 'text-ink-muted hover:bg-surface-800'
                      : 'cursor-not-allowed text-ink-faint',
                )}
              >
                <TrafficCone
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    trafficEnabled ? 'text-brand-700' : 'text-ink-faint',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px]">Trafico en tiempo real</span>
                    <PlanBadge featureId="live-traffic" available={trafficAvailable} />
                  </span>
                  {!trafficAvailable ? (
                    <span className="mt-0.5 block text-2xs leading-relaxed text-ink-faint">
                      {trafficAccess.includedInPlan
                        ? (traffic?.provider.unavailableReason ??
                          'Requiere un proveedor de trafico configurado.')
                        : trafficAccess.reason}
                    </span>
                  ) : null}
                </span>
                {trafficAvailable ? (
                  // Interruptor explicito: el tinte de fondo por si solo no
                  // se leia como un boton de encendido/apagado.
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
                      trafficEnabled ? 'bg-brand-500' : 'bg-surface-700',
                    )}
                  >
                    <span
                      className={cn(
                        'h-4 w-4 rounded-full bg-white transition-transform',
                        trafficEnabled && 'translate-x-4',
                      )}
                    />
                  </span>
                ) : (
                  <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                )}
              </button>
            </div>

            {trafficEnabled && trafficAvailable ? (
              <div className="mt-2 space-y-1 border-t border-line px-2 pt-2">
                <p className="field-label mb-1">Nivel de congestion</p>
                {(
                  [
                    ['Fluido', '#15803d'],
                    ['Moderado', '#b45309'],
                    ['Congestionado', '#c2410c'],
                    ['Muy congestionado', '#b91c1c'],
                  ] as const
                ).map(([label, color]) => (
                  <span key={label} className="flex items-center gap-2 text-2xs text-ink-muted">
                    <span className="h-1 w-5 rounded" style={{ backgroundColor: color }} />
                    {label}
                  </span>
                ))}
              </div>
            ) : null}

            {viewMode !== 'standard' ? (
              <p className="mt-2 border-t border-line px-2 pt-2 text-2xs text-ink-faint">
                <Badge tone="neutral" size="sm">
                  El mapa estandar sigue siendo el predeterminado
                </Badge>
              </p>
            ) : null}
      </MapPopover>
    </div>
  );
}
