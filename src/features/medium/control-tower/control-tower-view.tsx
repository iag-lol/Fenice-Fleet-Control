'use client';

import { useQuery } from '@tanstack/react-query';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { OperationalMap } from '@/components/map/operational-map';
import { hasFeature } from '@/product/feature-access';
import { OperationsPanel } from '@/features/medium/control-tower/operations-panel';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { Alert } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

/**
 * Torre de control: la unica pantalla de mapa del sistema.
 *
 * Es la misma pantalla en todos los planes, y crece con el contratado:
 *
 *  - PLAN BASICO: el mapa a pantalla completa, con todas sus capas, filtros
 *    y seleccion. Es la pantalla nucleo del plan y no se degrada en nada.
 *  - PLAN MEDIO en adelante: se le suma el panel de operacion, con flota,
 *    despachos, alertas y rutas junto al mapa. La division se puede arrastrar
 *    y se recuerda entre sesiones, porque cada operador reparte su atencion
 *    de forma distinta.
 *
 * Antes esto eran dos pantallas de menu ("Mapa operacional" y "Torre de
 * control") sobre el mismo mapa. Se unificaron: la diferencia era el panel,
 * no el mapa, y dos entradas para lo mismo confundian sin aportar.
 */

const MIN_PANEL = 280;
const MAX_PANEL = 560;
const DEFAULT_PANEL = 360;
const STORAGE_KEY = 'fenice.control.panelWidth';

export function ControlTowerView() {
  // El panel de operacion es Plan Medio. Sin el, la torre es exactamente el
  // mapa a pantalla completa que el Plan Basico siempre incluyo.
  const hasOperationsPanel = hasFeature('control-tower');
  const isDesktop = useIsDesktop();
  const { positions } = useLiveFleet();
  const select = useMapStore((s) => s.select);

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL);
  const [panelOpen, setPanelOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const stored = Number(window.localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored >= MIN_PANEL && stored <= MAX_PANEL) {
        setPanelWidth(stored);
      }
    } catch {
      // Sin almacenamiento: se usa el ancho por defecto.
    }
    setHydrated(true);
  }, []);

  const { data: snapshot } = useQuery({
    queryKey: ['map', 'snapshot'],
    refetchInterval: 120_000,
    queryFn: async (): Promise<MapSnapshot> => {
      const response = await fetch('/api/map');
      if (!response.ok) throw new Error('No fue posible cargar la informacion del mapa.');
      return (await response.json()) as MapSnapshot;
    },
  });

  const { data: alertsData } = useQuery({
    queryKey: ['alerts'],
    refetchInterval: 45_000,
    queryFn: async (): Promise<{ alerts: Alert[] }> => {
      const response = await fetch('/api/alertas');
      if (!response.ok) throw new Error('No fue posible cargar las alertas.');
      return (await response.json()) as { alerts: Alert[] };
    },
  });

  // --- Arrastre del divisor ------------------------------------------------
  const startDrag = useCallback(() => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    // Evita que el arrastre seleccione texto de la pagina.
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!draggingRef.current || !containerRef.current) return;
      const bounds = containerRef.current.getBoundingClientRect();
      const width = Math.round(bounds.right - event.clientX);
      setPanelWidth(Math.max(MIN_PANEL, Math.min(MAX_PANEL, width)));
    };

    const onUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        window.localStorage.setItem(STORAGE_KEY, String(panelWidth));
      } catch {
        // Sin persistencia: el ancho sigue aplicando en esta sesion.
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [panelWidth]);

  const openVehicle = useCallback(
    (vehicleId: string) => select({ type: 'vehicle', id: vehicleId }),
    [select],
  );
  const openWorkOrder = useCallback(
    (workOrderId: string) => select({ type: 'workOrder', id: workOrderId }),
    [select],
  );

  const panel = (
    <OperationsPanel
      snapshot={snapshot ?? null}
      alerts={alertsData?.alerts ?? []}
      positions={positions}
      onSelectVehicle={openVehicle}
      onSelectWorkOrder={openWorkOrder}
    />
  );

  return (
    <div ref={containerRef} className="relative flex h-full w-full overflow-hidden">
      <div className="relative min-w-0 flex-1">
        <OperationalMap />

        {/* Alternar el panel: en el mapa cada pixel horizontal cuenta. */}
        {isDesktop && hasOperationsPanel ? (
          <button
            type="button"
            onClick={() => setPanelOpen((value) => !value)}
            title={panelOpen ? 'Ocultar panel operacional' : 'Mostrar panel operacional'}
            aria-label={panelOpen ? 'Ocultar panel operacional' : 'Mostrar panel operacional'}
            className="absolute right-2.5 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md border border-line-strong bg-surface-900/95 text-ink-muted shadow-float backdrop-blur transition-colors hover:text-ink"
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        ) : null}
      </div>

      {/* --- Escritorio: panel lateral redimensionable --- */}
      {isDesktop && panelOpen && hasOperationsPanel ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar panel operacional"
            onPointerDown={startDrag}
            className="w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-brand-400"
          />
          <aside
            className={cn('h-full shrink-0 border-l border-line', !hydrated && 'invisible')}
            style={{ width: panelWidth }}
          >
            {panel}
          </aside>
        </>
      ) : null}

      {/* --- Movil: el panel vive bajo el mapa, deslizable --- */}
      {!isDesktop && hasOperationsPanel ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[42%] md:hidden">
          <div className="pointer-events-auto h-full overflow-hidden rounded-t-xl border-t border-line bg-surface-900 shadow-panel">
            <div className="flex justify-center pt-1.5">
              <span className="h-1 w-10 rounded-full bg-line-strong" aria-hidden />
            </div>
            {panel}
          </div>
        </div>
      ) : null}
    </div>
  );
}
