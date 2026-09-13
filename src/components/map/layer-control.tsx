'use client';

import {
  AlertTriangle,
  Building2,
  Flame,
  Layers,
  Landmark,
  Package,
  Route as RouteIcon,
  Shield,
  Truck,
} from 'lucide-react';
import { useRef, useState } from 'react';

import { MapPopover } from '@/components/map/map-popover';

import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useMapStore, type MapLayerId } from '@/stores/map-store';
import type { HeatmapMode } from '@/types/views';

const LAYERS: { id: MapLayerId; label: string; icon: typeof Truck; hint: string }[] = [
  { id: 'camiones', label: 'Camiones', icon: Truck, hint: 'Posicion y estado de la flota' },
  { id: 'clientes', label: 'Clientes', icon: Building2, hint: 'Pines por estado comercial' },
  { id: 'rutas', label: 'Rutas', icon: RouteIcon, hint: 'Planificada, ejecutada y paradas' },
  { id: 'geocercas', label: 'Geocercas', icon: Shield, hint: 'Perimetros de entrega y zonas' },
  { id: 'calor', label: 'Mapa de calor', icon: Flame, hint: 'Concentracion territorial' },
  { id: 'pedidos', label: 'Pedidos pendientes', icon: Package, hint: 'OT sin entregar' },
  { id: 'alertas', label: 'Alertas', icon: AlertTriangle, hint: 'Incidencias georreferenciadas' },
  { id: 'comunas', label: 'Comunas', icon: Landmark, hint: 'Limites administrativos' },
];

const HEATMAP_OPTIONS: { value: HeatmapMode; label: string }[] = [
  { value: 'clients', label: 'Concentracion de clientes' },
  { value: 'orders', label: 'Concentracion de pedidos' },
  { value: 'visits', label: 'Concentracion de visitas' },
  { value: 'dormant', label: 'Concentracion de clientes dormidos' },
];

/** Selector de capas. Permite combinar libremente todas las capas del mapa. */
export function LayerControl({ inline }: { inline?: boolean }) {
  const layers = useMapStore((s) => s.layers);
  const clusterClients = useMapStore((s) => s.clusterClients);
  const setClusterClients = useMapStore((s) => s.setClusterClients);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const heatmapMode = useMapStore((s) => s.heatmapMode);
  const setHeatmapMode = useMapStore((s) => s.setHeatmapMode);

  const activeCount = Object.values(layers).filter(Boolean).length;
  const [open, setOpen] = useState(inline ?? false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  const body = (
    <div className="space-y-2">
      <ul className="space-y-0.5">
        {LAYERS.map((layer) => {
          const Icon = layer.icon;
          const enabled = layers[layer.id];

          return (
            <li key={layer.id}>
              <button
                type="button"
                onClick={() => toggleLayer(layer.id)}
                role="switch"
                aria-checked={enabled}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  enabled ? 'bg-brand-500/12 text-ink' : 'text-ink-muted hover:bg-surface-800',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', enabled ? 'text-brand-700' : 'text-ink-faint')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{layer.label}</span>
                  <span className="block truncate text-2xs text-ink-faint">{layer.hint}</span>
                </span>
                <span
                  className={cn(
                    'flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
                    enabled ? 'bg-brand-500' : 'bg-surface-700',
                  )}
                >
                  <span
                    className={cn(
                      'h-3 w-3 rounded-full bg-white transition-transform',
                      enabled && 'translate-x-3',
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        Desagrupar clientes.
        Solo tiene sentido con la capa de clientes encendida, y por eso
        aparece justo debajo de ella en vez de en un menu aparte.
      */}
      {layers.clientes ? (
        <div className="border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setClusterClients(!clusterClients)}
            aria-pressed={!clusterClients}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-left transition-colors hover:bg-surface-800"
          >
            <span className="min-w-0">
              <span className="block text-[13px] text-ink">
                {clusterClients ? 'Agrupar clientes cercanos' : 'Clientes desagrupados'}
              </span>
              <span className="block text-2xs leading-snug text-ink-faint">
                {clusterClients
                  ? 'Los circulos con numero reunen varios domicilios'
                  : 'Se dibuja un pin por domicilio, aunque se solapen'}
              </span>
            </span>
            <span
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                clusterClients ? 'bg-brand-600' : 'bg-surface-700',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                  clusterClients ? 'translate-x-4' : 'translate-x-0.5',
                )}
              />
            </span>
          </button>
        </div>
      ) : null}

      {layers.calor ? (
        <div className="border-t border-line pt-2">
          <label className="field-label">Modo del mapa de calor</label>
          <Select
            value={heatmapMode}
            onChange={(event) => setHeatmapMode(event.target.value as HeatmapMode)}
            options={HEATMAP_OPTIONS}
          />
        </div>
      ) : null}
    </div>
  );

  if (inline) return body;

  return (
    <div className="relative">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        // En movil la etiqueta va oculta y el boton quedaba sin nombre
        // accesible: un icono solo, ilegible para un lector de pantalla.
        title="Capas del mapa"
        aria-label="Capas del mapa"
        className="tap flex items-center gap-2 rounded-md border border-line-strong bg-surface-900/95 px-3 text-[13px] text-ink shadow-float backdrop-blur transition-colors hover:border-brand-500 sm:h-9 sm:min-h-0"
      >
        <Layers className="h-4 w-4 text-brand-700" />
        <span className="hidden sm:inline">Capas</span>
        <Badge tone="brand" size="sm">
          {activeCount}
        </Badge>
      </button>

      <MapPopover
        open={open}
        onClose={() => setOpen(false)}
        title="Capas del mapa"
        width={280}
        anchorRef={anchorRef}
      >
        {body}
      </MapPopover>
    </div>
  );
}
