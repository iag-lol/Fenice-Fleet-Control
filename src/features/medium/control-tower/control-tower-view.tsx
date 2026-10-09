'use client';

import { useQuery } from '@tanstack/react-query';
import { ListFilter, PanelRightClose, PanelRightOpen, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { OperationalMap } from '@/components/map/operational-map';
import { ClientPanel } from '@/components/map/client-panel';
import { MapEntityPanel } from '@/components/map/map-entity-panel';
import { VehiclePanel } from '@/components/map/vehicle-panel';
import { WorkOrderPanel } from '@/components/map/work-order-panel';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { hasFeature } from '@/product/feature-access';
import { OperationsPanel } from '@/features/medium/control-tower/operations-panel';
import {
  useIsDesktop,
  useIsPortraitTablet,
  useIsTabletRange,
} from '@/hooks/use-media-query';
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

const MIN_PANEL = 280;
const MAX_PANEL = 560;
const DEFAULT_PANEL = 360;
const STORAGE_KEY = 'fenice.control.panelWidth';
const PANEL_OPEN_STORAGE_KEY = 'fenice.control.panelOpen';

export function ControlTowerView() {
  // El panel operativo acompaña al mapa en todos los planes.
  const hasOperationsPanel = hasFeature('control-tower');
  const isDesktop = useIsDesktop();
  const isPortraitTablet = useIsPortraitTablet();
  const isTabletRange = useIsTabletRange();
  const usesMobileLayout = !isDesktop || isPortraitTablet;
  const { positions, payload: livePayload } = useLiveFleet();
  const select = useMapStore((s) => s.select);
  const currentSelection = useMapStore((s) => s.selection);
  const detailOpen = useMapStore((s) => s.detailOpen);
  const closeDetail = useMapStore((s) => s.closeDetail);

  const [panelWidth, setPanelWidth] = useState(DEFAULT_PANEL);
  // Igual que el sidebar: abierto por defecto, salvo en tablet, donde ya
  // compite por ancho con el sidebar y el mapa. Sin este ajuste, ambos se
  // abrian a la vez y no dejaban espacio real para el mapa ni sus controles.
  const [panelOpen, setPanelOpen] = useState(true);
  const [hasStoredPanelPreference, setHasStoredPanelPreference] = useState(false);
  const mobilePanelOpen = useMapStore((s) => s.mobileOperationsOpen);
  const setMobilePanelOpen = useMapStore((s) => s.setMobileOperationsOpen);
  const [hydrated, setHydrated] = useState(false);
  const draggingRef = useRef(false);
  const dragOriginRef = useRef({ clientX: 0, width: DEFAULT_PANEL });
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
    // En tablet el mapa debe partir siempre con todo el ancho disponible,
    // aunque exista una preferencia guardada desde escritorio. El operador
    // aun puede abrir el panel manualmente con su control lateral.
    if (isTabletRange) {
      setPanelOpen(false);
      return;
    }
    if (!hasStoredPanelPreference) setPanelOpen(true);
  }, [isTabletRange, hasStoredPanelPreference]);

  useEffect(() => {
    if (!usesMobileLayout || !mobilePanelOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMobilePanelOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [usesMobileLayout, mobilePanelOpen, setMobilePanelOpen]);

  // Al elegir una entidad desde el inventario movil, vuelve al mapa para que
  // el encuadre y la ficha seleccionada sean visibles de inmediato.
  useEffect(() => {
    if (usesMobileLayout && currentSelection) setMobilePanelOpen(false);
  }, [currentSelection, usesMobileLayout, setMobilePanelOpen]);

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
  const snapshot = useMemo(
    () =>
      map.data
        ? { ...map.data, vehicles: livePayload?.vehicles ?? map.data.vehicles }
        : undefined,
    [map.data, livePayload?.vehicles],
  );
  const desktopSelection = usesMobileLayout || !detailOpen ? null : currentSelection;
  const visiblePanelWidth = desktopSelection ? Math.max(panelWidth, 400) : panelWidth;
  const refreshAll = () => {
    void map.refetch();
    void alerts.refetch();
    void communes.refetch();
  };

  // --- Arrastre del divisor ------------------------------------------------
  const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // Medir el desplazamiento desde el ancho actual evita saltos al tomar el
    // divisor, independientemente de los margenes exteriores de la pantalla.
    dragOriginRef.current = { clientX: event.clientX, width: visiblePanelWidth };
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    // Evita que el arrastre seleccione texto de la pagina.
    document.body.style.userSelect = 'none';
  }, [visiblePanelWidth]);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (!draggingRef.current || !containerRef.current) return;
      const origin = dragOriginRef.current;
      const width = Math.round(origin.width + origin.clientX - event.clientX);
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
      hideHeader={!isDesktop}
      snapshot={snapshot ?? null}
      sourceStatus={
        mode && (mode.gps.provider === 'unavailable' || mode.operations.provider === 'mock')
          ? `GPS: ${mode.gps.label}. Operaciones: ${mode.operations.label}.`
          : undefined
      }
      alerts={alerts.data?.alerts ?? []}
      communes={communes.data?.communes ?? []}
      loading={map.isLoading}
      error={[(livePayload ?? snapshot)?.availabilityWarnings?.join(' '), map.error, alerts.error, communes.error]
        .filter(Boolean)
        .map((e) => typeof e === 'string' ? e : e?.message)
        .join(' ')}
      refreshing={map.isFetching || alerts.isFetching || communes.isFetching}
      onRefresh={refreshAll}
      positions={positions}
      onSelectVehicle={openVehicle}
      onSelectWorkOrder={openWorkOrder}
    />
  );

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 w-full overflow-hidden p-2 md:p-3 xl:p-4">
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-surface-900 shadow-card">
        <OperationalMap detailExternal={Boolean(desktopSelection)} mobileDockClearance={usesMobileLayout ? 80 : 0} />

        {/* Alternar el panel: en el mapa cada pixel horizontal cuenta. */}
        {!usesMobileLayout && hasOperationsPanel && !desktopSelection ? (
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

      {/*
        Escritorio: una sola columna lateral.

        Al seleccionar una entidad, su ficha REEMPLAZA el inventario
        operacional. Nunca se dibuja por encima de el ni del mapa; el flex
        recalcula el ancho disponible y MapLibre recibe el resize normal.
      */}
      {!usesMobileLayout && (desktopSelection || (panelOpen && hasOperationsPanel)) ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            aria-valuemin={MIN_PANEL}
            aria-valuemax={MAX_PANEL}
            aria-valuenow={visiblePanelWidth}
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
            className="group flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
          >
            <span aria-hidden="true" className="h-12 w-1 rounded-full bg-line-strong transition-colors group-hover:bg-brand-400 group-focus-visible:bg-brand-400" />
          </div>
          <aside
            className={cn(
              'h-full min-h-0 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-900 shadow-card',
              !hydrated && 'invisible',
            )}
            style={{ width: visiblePanelWidth }}
          >
            {desktopSelection ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
                  <h2 className="text-sm font-semibold text-ink">
                    {desktopSelection.type === 'vehicle'
                      ? 'Ficha del vehículo'
                      : desktopSelection.type === 'client'
                        ? 'Ficha del cliente'
                        : desktopSelection.type === 'workOrder'
                          ? 'Orden de trabajo'
                          : desktopSelection.type === 'geofence'
                            ? 'Detalle de geocerca'
                            : desktopSelection.type === 'route'
                              ? 'Detalle de ruta'
                              : 'Detalle de alerta'}
                  </h2>
                  <button
                    type="button"
                    onClick={closeDetail}
                    aria-label="Cerrar ficha de detalle"
                    title="Cerrar ficha"
                    className="flex h-8 w-8 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-surface-800 hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                  <ErrorBoundary section="la ficha seleccionada">
                    {desktopSelection.type === 'vehicle' ? (
                      <VehiclePanel vehicleId={desktopSelection.id} />
                    ) : desktopSelection.type === 'client' ? (
                      <ClientPanel clientId={desktopSelection.id} />
                    ) : desktopSelection.type === 'workOrder' ? (
                      <WorkOrderPanel
                        workOrderId={desktopSelection.id}
                        snapshot={snapshot ?? null}
                      />
                    ) : (
                      <MapEntityPanel selection={desktopSelection} snapshot={snapshot ?? null} />
                    )}
                  </ErrorBoundary>
                </div>
              </div>
            ) : (
              panel
            )}
          </aside>
        </>
      ) : null}

      {usesMobileLayout && hasOperationsPanel && mobilePanelOpen ? (
        <section
          id="mobile-operations-panel"
          className="mobile-layout-flex fixed inset-0 z-[70] flex min-h-0 flex-col bg-surface-950 animate-fade-in md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Centro operacional"
        >
          <div className="safe-top shrink-0 border-b border-white/10 bg-[#0d2430] text-white shadow-float">
            <div className="flex h-16 items-center gap-3 px-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-400/15 text-brand-300 ring-1 ring-white/10">
                <ListFilter className="h-4.5 w-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Centro operacional</span>
                <span className="block truncate text-2xs text-slate-400">
                  Flota, clientes, geocercas y despachos
                </span>
              </span>
              <button
                type="button"
                onClick={refreshAll}
                disabled={map.isFetching || alerts.isFetching || communes.isFetching}
                aria-label="Actualizar datos"
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4',
                    (map.isFetching || alerts.isFetching || communes.isFetching) && 'animate-spin',
                  )}
                />
              </button>
              <button
                type="button"
                onClick={() => setMobilePanelOpen(false)}
                aria-label="Cerrar centro operacional"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/15"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 bg-surface-900">{panel}</div>
        </section>
      ) : null}
    </div>
  );
}
