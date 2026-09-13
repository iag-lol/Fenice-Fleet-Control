'use client';

import { useQuery } from '@tanstack/react-query';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { OperationalMap } from '@/components/map/operational-map';
import { hasFeature } from '@/product/feature-access';
import { OperationsPanel } from '@/features/medium/control-tower/operations-panel';
import { useIsDesktop, useIsTabletRange } from '@/hooks/use-media-query';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import { systemModeQuery, useControlData } from '@/hooks/use-control-data';

/**
 * Torre de control: la unica pantalla de mapa del sistema.
 *
 * Es la misma pantalla en todos los planes, y crece con el contratado:
 *
 * El mapa y su panel operan juntos en todos los planes. La division puede
 * arrastrarse y conserva el ancho elegido por cada operador.
 *
 * Antes esto eran dos pantallas de menu ("Mapa operacional" y "Torre de
 * control") sobre el mismo mapa. Se unificaron: la diferencia era el panel,
 * no el mapa, y dos entradas para lo mismo confundian sin aportar.
 */

/**
 * Alturas de la hoja movil, como fraccion de la pantalla.
 *
 * Arranca en la minima: en un telefono el mapa es lo que no cabe en ningun
 * otro sitio, y la lista siempre esta a un toque.
 */
const SHEET_HEIGHTS = ['40%', '60%', '88%'] as const;
type SheetStep = 0 | 1 | 2;

const MIN_PANEL = 280;
const MAX_PANEL = 560;
const DEFAULT_PANEL = 360;
const STORAGE_KEY = 'fenice.control.panelWidth';
const PANEL_OPEN_STORAGE_KEY = 'fenice.control.panelOpen';

export function ControlTowerView() {
  // El panel operativo acompaña al mapa en todos los planes.
  const hasOperationsPanel = hasFeature('control-tower');
  const isDesktop = useIsDesktop();
  const isTabletRange = useIsTabletRange();
  const { positions } = useLiveFleet();
  const select = useMapStore((s) => s.select);

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL);
  // Igual que el sidebar: abierto por defecto, salvo en tablet, donde ya
  // compite por ancho con el sidebar y el mapa. Sin este ajuste, ambos se
  // abrian a la vez y no dejaban espacio real para el mapa ni sus controles.
  const [panelOpen, setPanelOpen] = useState(true);
  const [hasStoredPanelPreference, setHasStoredPanelPreference] = useState(false);
  const [sheetStep, setSheetStep] = useState<SheetStep>(0);
  const [hydrated, setHydrated] = useState(false);
  const draggingRef = useRef(false);
  const panelWidthRef = useRef(panelWidth);
  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);
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

    try {
      const storedOpen = window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY);
      if (storedOpen !== null) {
        setPanelOpen(storedOpen === '1');
        setHasStoredPanelPreference(true);
      }
    } catch {
      // Sin almacenamiento: se usa el valor por defecto.
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasStoredPanelPreference) setPanelOpen(!isTabletRange);
  }, [isTabletRange, hasStoredPanelPreference]);

  const togglePanel = useCallback(() => {
    setPanelOpen((current) => {
      const next = !current;
      setHasStoredPanelPreference(true);
      try {
        window.localStorage.setItem(PANEL_OPEN_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Sin persistencia: el cambio sigue aplicando en esta sesion.
      }
      return next;
    });
  }, []);

  const { map, alerts, communes } = useControlData();
  const { data: mode } = useQuery(systemModeQuery);
  const snapshot = map.data;
  const refreshAll = () => {
    void map.refetch();
    void alerts.refetch();
    void communes.refetch();
  };

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
        window.localStorage.setItem(STORAGE_KEY, String(panelWidthRef.current));
      } catch {
        // Sin persistencia: el ancho sigue aplicando en esta sesion.
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, []);

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
      sourceStatus={
        mode && (mode.gps.provider === 'unavailable' || mode.operations.provider === 'mock')
          ? `GPS: ${mode.gps.label}. Operaciones: ${mode.operations.label}.`
          : undefined
      }
      alerts={alerts.data?.alerts ?? []}
      communes={communes.data?.communes ?? []}
      loading={map.isLoading}
      error={[map.error, alerts.error, communes.error]
        .filter(Boolean)
        .map((e) => e?.message)
        .join(' ')}
      refreshing={map.isFetching || alerts.isFetching || communes.isFetching}
      onRefresh={refreshAll}
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
            onClick={togglePanel}
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
            tabIndex={0}
            aria-valuemin={MIN_PANEL}
            aria-valuemax={MAX_PANEL}
            aria-valuenow={panelWidth}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const width =
                event.key === 'Home'
                  ? MIN_PANEL
                  : event.key === 'End'
                    ? MAX_PANEL
                    : Math.max(
                        MIN_PANEL,
                        Math.min(MAX_PANEL, panelWidth + (event.key === 'ArrowLeft' ? 20 : -20)),
                      );
              setPanelWidth(width);
              try {
                window.localStorage.setItem(STORAGE_KEY, String(width));
              } catch {
                /* Optional persistence. */
              }
            }}
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

      {/*
        --- Movil: hoja bajo el mapa, con tres alturas ---

        Una altura fija no sirve para las dos cosas que se hacen aqui: mirar
        el mapa (quiero la hoja pequena) y revisar la lista (quiero la hoja
        grande). Se arranca en la altura minima para que el mapa mande, y el
        tirador cicla entre las tres.
      */}
      {!isDesktop && hasOperationsPanel ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-30 transition-[height] duration-200 md:hidden"
          style={{ height: SHEET_HEIGHTS[sheetStep] }}
        >
          <div className="pointer-events-auto flex h-full flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface-900 shadow-panel">
            <button
              type="button"
              onClick={() =>
                setSheetStep((step) => ((step + 1) % SHEET_HEIGHTS.length) as SheetStep)
              }
              aria-label={
                sheetStep === SHEET_HEIGHTS.length - 1 ? 'Reducir el panel' : 'Ampliar el panel'
              }
              className="flex min-h-11 w-full shrink-0 items-center justify-center"
            >
              <span className="h-1.5 w-11 rounded-full bg-line-strong" aria-hidden />
            </button>
            <div className="min-h-0 flex-1">{panel}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
