'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  Filter,
  Maximize2,
  Minimize2,
  Navigation,
  Package,
  Target,
  Truck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  isScoped,
  scopePoints,
  scopeRoutes,
  scopeVehicles,
  type ScopeInput,
} from '@/lib/engines/map-scope';
import { FocusBanner } from '@/components/map/focus-banner';
import { ClientFiltersPanel, applyClientFilters } from '@/components/map/client-filters-panel';
import { CommunePanel, type CommuneWithSummary } from '@/components/map/commune-panel';
import { ClientPanel } from '@/components/map/client-panel';
import { FleetMap, type FleetMapVehicle } from '@/components/map/fleet-map';
import { LayerControl } from '@/components/map/layer-control';
import { ViewModeControl } from '@/components/map/view-mode-control';
import { VehiclePanel } from '@/components/map/vehicle-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Sheet } from '@/components/ui/sheet';
import { GpsDegradedNotice, QueryError } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { OPERATION_BOUNDS } from '@/data/communes';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { BoundaryMetadata } from '@/data/administrative-boundaries';
import type { MapSnapshot, TerritoryAnalysis } from '@/types/views';
import type { TrafficProviderInfo, TrafficSegment } from '@/services/traffic/traffic-provider';

interface CommunesResponse {
  metadata: BoundaryMetadata;
  communes: CommuneWithSummary[];
}

/**
 * Centro operacional.
 *
 * El mapa ocupa toda la superficie disponible: no es una tarjeta dentro de un
 * panel, es la aplicacion. Los controles flotan encima y las fichas se abren
 * como panel lateral en escritorio y hoja inferior en movil.
 */
export function OperationalMap() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { positions, error: gpsError, lastUpdateAt, refresh } = useLiveFleet();

  const layers = useMapStore((s) => s.layers);
  const heatmapMode = useMapStore((s) => s.heatmapMode);
  const filters = useMapStore((s) => s.filters);
  const activeFilterCount = useMapStore((s) => s.activeFilterCount());
  const selection = useMapStore((s) => s.select);
  const currentSelection = useMapStore((s) => s.selection);
  const following = useMapStore((s) => s.followingVehicleId);
  const followVehicle = useMapStore((s) => s.followVehicle);
  const focusOn = useMapStore((s) => s.focusOn);
  const highlightedRouteId = useMapStore((s) => s.highlightedRouteId);
  const highlightRoute = useMapStore((s) => s.highlightRoute);
  const inspectedCommuneCode = useMapStore((s) => s.inspectedCommuneCode);
  const inspectCommune = useMapStore((s) => s.inspectCommune);
  const isolate = useMapStore((s) => s.isolate);
  const scopedCommuneCode = useMapStore((s) => s.scopedCommuneCode);
  const scopeToCommune = useMapStore((s) => s.scopeToCommune);
  const trafficEnabled = useMapStore((s) => s.trafficEnabled);

  const {
    data: snapshot,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['map', 'snapshot'],
    // La instantanea trae capas estaticas; las posiciones llegan por el stream.
    refetchInterval: 120_000,
    queryFn: async (): Promise<MapSnapshot> => {
      const response = await fetch('/api/map');
      if (!response.ok) throw new Error('No fue posible cargar la informacion del mapa.');
      return (await response.json()) as MapSnapshot;
    },
  });

  // El mapa de calor solo se descarga cuando la capa esta activa.
  const { data: territory } = useQuery({
    queryKey: ['territory'],
    enabled: layers.calor,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TerritoryAnalysis> => {
      const response = await fetch('/api/territorio');
      if (!response.ok) throw new Error('No fue posible cargar el analisis territorial.');
      return (await response.json()) as TerritoryAnalysis;
    },
  });

  // Los limites comunales pesan cientos de kilobytes: solo se descargan
  // cuando el operador enciende la capa.
  const { data: communesData } = useQuery({
    queryKey: ['communes'],
    enabled: layers.comunas,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CommunesResponse> => {
      const response = await fetch('/api/comunas');
      if (!response.ok) throw new Error('No fue posible cargar los limites comunales.');
      return (await response.json()) as CommunesResponse;
    },
  });

  // El trafico solo se descarga cuando el operador enciende la capa: es una
  // consulta a un proveedor externo pago, no algo que se pida de fondo.
  const { data: trafficData } = useQuery({
    queryKey: ['traffic', 'segments'],
    enabled: trafficEnabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async (): Promise<{ provider: TrafficProviderInfo; segments: TrafficSegment[] }> => {
      const response = await fetch('/api/trafico');
      if (!response.ok) throw new Error('No fue posible cargar el trafico.');
      return (await response.json()) as { provider: TrafficProviderInfo; segments: TrafficSegment[] };
    },
  });

  const trafficSegments = useMemo(
    () => (trafficEnabled ? (trafficData?.segments ?? []) : []),
    [trafficEnabled, trafficData],
  );

  const communeFeatures = useMemo(
    () =>
      (communesData?.communes ?? []).map((c) => ({
        code: c.code,
        name: c.name,
        center: c.center,
        boundary: c.boundary,
        clients: c.summary?.clients ?? 0,
      })),
    [communesData],
  );

  const inspectedCommune = useMemo(
    () => communesData?.communes.find((c) => c.code === inspectedCommuneCode) ?? null,
    [communesData, inspectedCommuneCode],
  );

  const allClients = useMemo(() => snapshot?.clients ?? [], [snapshot]);
  const visibleClients = useMemo(
    () => applyClientFilters(allClients, filters),
    [allClients, filters],
  );

  const vehicles: FleetMapVehicle[] = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.vehicles.map((v) => ({
      vehicleId: v.vehicle.id,
      plate: v.vehicle.plate,
      fleetCode: v.vehicle.fleetCode,
      status: v.activityStatus,
      // La posicion viva del stream tiene prioridad sobre la de la instantanea.
      position: positions.get(v.vehicle.id) ?? v.position,
    }));
  }, [snapshot, positions]);

  /**
   * Enfoque activo.
   *
   * Concentra el mapa en lo que el operador esta mirando. Se puede apagar
   * desde el propio mapa, para que nunca sea una desaparicion inexplicable.
   */
  const scope: ScopeInput = useMemo(() => {
    if (!isolate) {
      return { vehicleId: null, routeId: null, communeBoundary: null };
    }
    const comuna = scopedCommuneCode
      ? (communesData?.communes.find((c) => c.code === scopedCommuneCode) ?? null)
      : null;

    return {
      vehicleId: currentSelection?.type === 'vehicle' ? currentSelection.id : null,
      routeId: highlightedRouteId,
      communeBoundary: comuna?.boundary ?? null,
    };
  }, [isolate, scopedCommuneCode, communesData, currentSelection, highlightedRouteId]);

  const scopeActivo = isScoped(scope);

  const routesEnfocadas = useMemo(
    () => (snapshot ? scopeRoutes(snapshot.routes, scope) : []),
    [snapshot, scope],
  );
  const vehiculosEnfocados = useMemo(
    () => scopeVehicles(vehicles, scope, snapshot?.routes ?? []),
    [vehicles, scope, snapshot],
  );
  const clientesEnfocados = useMemo(
    () => scopePoints(visibleClients, scope, snapshot?.routes ?? []),
    [visibleClients, scope, snapshot],
  );
  const pedidosEnfocados = useMemo(
    () => scopePoints(snapshot?.pendingWorkOrders ?? [], scope, snapshot?.routes ?? []),
    [snapshot, scope],
  );

  const heatmapPoints = useMemo(() => {
    if (!territory) return [];
    return territory.heatmaps[heatmapMode];
  }, [territory, heatmapMode]);

  const followedVehicle = vehicles.find((v) => v.vehicleId === following) ?? null;

  const openDetail = useCallback(() => setDetailOpen(true), []);

  // Abrir la ficha automaticamente al seleccionar desde el mapa.
  useEffect(() => {
    if (currentSelection?.type === 'vehicle' || currentSelection?.type === 'client') {
      setDetailOpen(true);
    }
  }, [currentSelection]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    selection(null);
  }, [selection]);

  const fitOperation = useCallback(() => {
    const center = {
      lat: (OPERATION_BOUNDS.minLat + OPERATION_BOUNDS.maxLat) / 2,
      lng: (OPERATION_BOUNDS.minLng + OPERATION_BOUNDS.maxLng) / 2,
    };
    focusOn(center, 10.4);
  }, [focusOn]);

  // Pantalla completa dentro de la aplicacion.
  const toggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void node.requestFullscreen?.().catch(() => {
        // Algunos navegadores moviles lo bloquean: se degrada al modo interno.
        setFullscreen((value) => !value);
      });
    }
  }, []);

  useEffect(() => {
    const onChange = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (isError) {
    return (
      <div className="p-4">
        <QueryError
          title="No fue posible cargar el mapa operacional"
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const vehicleCounts = {
    total: vehicles.length,
    enRuta: snapshot?.vehicles.filter((v) => v.status === 'en_ruta').length ?? 0,
    offline: snapshot?.vehicles.filter((v) => v.status === 'offline').length ?? 0,
  };

  return (
    <div ref={containerRef} className={cn('relative h-full w-full bg-surface-950', fullscreen && 'fixed inset-0 z-[70]')}>
      {isLoading || !snapshot ? (
        <div className="absolute inset-0 p-4">
          <Skeleton className="h-full w-full" />
          <p className="absolute inset-0 flex items-center justify-center text-xs text-ink-faint">
            Cargando centro operacional...
          </p>
        </div>
      ) : (
        <ErrorBoundary section="el mapa operacional">
          <FleetMap
            className="absolute inset-0"
            vehicles={layers.camiones ? vehiculosEnfocados : []}
            clients={clientesEnfocados}
            routes={routesEnfocadas}
            geofences={snapshot.geofences}
            alerts={snapshot.alerts}
            workOrders={pedidosEnfocados}
            communes={communeFeatures}
            heatmapPoints={heatmapPoints}
            trafficSegments={trafficSegments}
            onSelectVehicle={openDetail}
            onSelectClient={openDetail}
            onSelectWorkOrder={openDetail}
            onSelectCommune={inspectCommune}
          />
        </ErrorBoundary>
      )}

      {/*
        --- Barra superior de controles ---

        En movil se apila: el resumen de flota arriba y los controles debajo.
        En una sola fila, el resumen y los cuatro botones sumaban mas de 390 px
        y el ultimo control quedaba cortado fuera de la pantalla.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-start gap-2 p-2.5 sm:flex-row sm:items-start sm:justify-between sm:p-3">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line-strong bg-surface-900/95 px-2.5 py-1.5 text-2xs shadow-float backdrop-blur sm:gap-2">
            <Truck className="h-3.5 w-3.5 text-brand-700" />
            <span className="numeric font-medium text-ink">{vehicleCounts.enRuta}</span>
            <span className="text-ink-faint">en ruta</span>
            <span className="text-line-strong">·</span>
            <span className="numeric font-medium text-ink">{vehicleCounts.total}</span>
            <span className="text-ink-faint">flota</span>
            {vehicleCounts.offline > 0 ? (
              <>
                <span className="text-line-strong">·</span>
                <span className="numeric font-medium text-status-dormant">
                  {vehicleCounts.offline}
                </span>
                <span className="text-ink-faint">offline</span>
              </>
            ) : null}
          </div>

          <div className="hidden items-center gap-2 whitespace-nowrap rounded-md border border-line-strong bg-surface-900/95 px-2.5 py-1.5 text-2xs shadow-float backdrop-blur sm:flex">
            <Building2 className="h-3.5 w-3.5 text-brand-700" />
            <span className="numeric font-medium text-ink">{visibleClients.length}</span>
            <span className="text-ink-faint">de</span>
            <span className="numeric font-medium text-ink">{allClients.length}</span>
            <span className="text-ink-faint">clientes visibles</span>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            className="tap relative flex items-center gap-2 rounded-md border border-line-strong bg-surface-900/95 px-3 text-[13px] text-ink shadow-float backdrop-blur transition-colors hover:border-brand-500 sm:h-9 sm:min-h-0"
          >
            <Filter className="h-4 w-4 text-brand-700" />
            <span className="hidden sm:inline">Filtros</span>
            {activeFilterCount > 0 ? <Badge tone="brand" size="sm">{activeFilterCount}</Badge> : null}
          </button>

          <LayerControl />
          <ViewModeControl />

          <button
            type="button"
            onClick={fitOperation}
            title="Ver toda la operacion"
            aria-label="Ver toda la operacion"
            className="tap flex items-center justify-center rounded-md border border-line-strong bg-surface-900/95 px-2.5 text-ink shadow-float backdrop-blur transition-colors hover:border-brand-500 sm:h-9 sm:w-9 sm:min-h-0 sm:min-w-0 sm:px-0"
          >
            <Target className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={toggleFullscreen}
            title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            className="tap hidden items-center justify-center rounded-md border border-line-strong bg-surface-900/95 px-2.5 text-ink shadow-float backdrop-blur transition-colors hover:border-brand-500 sm:flex sm:h-9 sm:w-9 sm:min-h-0 sm:min-w-0 sm:px-0"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* --- Aviso de degradacion GPS --- */}
      {gpsError ? (
        <div className="pointer-events-auto absolute inset-x-2.5 top-16 z-10 sm:inset-x-auto sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2">
          <GpsDegradedNotice lastKnownAt={lastUpdateAt} onRetry={refresh} />
        </div>
      ) : null}

      {/* --- Panel territorial de la comuna seleccionada --- */}
      {inspectedCommune ? (
        <div className="pointer-events-none absolute bottom-24 left-2.5 z-20 sm:bottom-4">
          <CommunePanel commune={inspectedCommune} onClose={() => inspectCommune(null)} />
        </div>
      ) : null}

      {/* --- Que se esta mirando --- */}
      {scopeActivo || currentSelection?.type === 'vehicle' || highlightedRouteId || scopedCommuneCode ? (
        <div className="absolute bottom-24 left-2.5 z-20 sm:bottom-4">
          <FocusBanner
            vehiclePlate={
              currentSelection?.type === 'vehicle'
                ? (vehicles.find((v) => v.vehicleId === currentSelection.id)?.plate ?? null)
                : null
            }
            routeCode={
              highlightedRouteId
                ? (snapshot?.routes.find((r) => r.routeId === highlightedRouteId)?.code ??
                  highlightedRouteId)
                : null
            }
            communeName={
              scopedCommuneCode
                ? (communesData?.communes.find((c) => c.code === scopedCommuneCode)?.name ?? null)
                : null
            }
            hiddenCount={
              Math.max(0, vehicles.length - vehiculosEnfocados.length) +
              Math.max(0, visibleClients.length - clientesEnfocados.length)
            }
            onClearVehicle={() => {
              selection(null);
              followVehicle(null);
            }}
            onClearRoute={() => highlightRoute(null)}
            onClearCommune={() => scopeToCommune(null)}
          />
        </div>
      ) : null}

      {/* --- Barra de seguimiento --- */}
      {following && followedVehicle ? (
        <div className="pointer-events-auto safe-bottom absolute inset-x-2.5 bottom-[70px] z-20 flex items-center gap-3 rounded-lg border border-brand-500/40 bg-surface-900/97 px-3 py-2.5 shadow-panel backdrop-blur sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500/20 text-brand-700">
            <Navigation className="h-4 w-4" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">
              Siguiendo {followedVehicle.plate}
              <span className="ml-2 text-2xs font-normal text-ink-faint">
                {followedVehicle.fleetCode}
              </span>
            </p>
            <p className="numeric truncate text-2xs text-ink-faint">
              {followedVehicle.position
                ? `${Math.round(followedVehicle.position.speed)} km/h · rumbo ${Math.round(followedVehicle.position.heading)}°`
                : 'Sin posicion disponible'}
            </p>
          </div>

          <Button size="sm" variant="secondary" onClick={() => followVehicle(null)}>
            Cancelar
          </Button>
        </div>
      ) : null}

      {/* --- Leyenda --- */}
      <div className="pointer-events-none absolute bottom-[70px] right-2.5 z-10 hidden flex-col gap-1 rounded-md border border-line bg-surface-900/90 px-2.5 py-2 text-2xs shadow-float backdrop-blur lg:flex lg:bottom-24 lg:right-14">
        <p className="mb-0.5 font-semibold uppercase tracking-wider text-ink-faint">Clientes</p>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-status-active" /> Activo
        </span>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-status-warning" /> En observacion
        </span>
        <span className="flex items-center gap-1.5 text-ink-muted">
          <span className="h-2 w-2 rounded-full bg-status-dormant" /> Dormido
        </span>
      </div>

      {/* --- Filtros --- */}
      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filtros del mapa"
        description="Combina estado comercial, sector y antiguedad"
        side="left"
        transparentOverlay
      >
        <ClientFiltersPanel
          allClients={allClients}
          visibleCount={visibleClients.length}
          totalCount={allClients.length}
        />
        <div className="border-t border-line p-3 sm:hidden">
          <div className="mb-3">
            <p className="field-label">Capas visibles</p>
            <LayerControl inline />
          </div>
          <Button block variant="primary" onClick={() => setFiltersOpen(false)}>
            Ver {visibleClients.length} clientes en el mapa
          </Button>
        </div>
      </Sheet>

      {/* --- Ficha de detalle --- */}
      <Sheet
        open={detailOpen && currentSelection !== null}
        onClose={closeDetail}
        title={
          currentSelection?.type === 'vehicle'
            ? 'Ficha del vehiculo'
            : currentSelection?.type === 'client'
              ? 'Ficha del cliente'
              : 'Orden de trabajo'
        }
        transparentOverlay
      >
        <ErrorBoundary section="la ficha seleccionada">
          {currentSelection?.type === 'vehicle' ? (
            <VehiclePanel vehicleId={currentSelection.id} />
          ) : currentSelection?.type === 'client' ? (
            <ClientPanel clientId={currentSelection.id} />
          ) : currentSelection?.type === 'workOrder' ? (
            <WorkOrderQuickPanel
              workOrderId={currentSelection.id}
              snapshot={snapshot ?? null}
            />
          ) : null}
        </ErrorBoundary>
      </Sheet>
    </div>
  );
}

/** Vista rapida de una OT seleccionada en el mapa. */
function WorkOrderQuickPanel({
  workOrderId,
  snapshot,
}: {
  workOrderId: string;
  snapshot: MapSnapshot | null;
}) {
  const workOrder = snapshot?.pendingWorkOrders.find((w) => w.workOrderId === workOrderId);
  const stop = snapshot?.routes
    .flatMap((route) => route.stops.map((s) => ({ ...s, routeId: route.routeId, code: route.code })))
    .find((s) => s.workOrderId === workOrderId);

  const focusOn = useMapStore((s) => s.focusOn);

  const name = workOrder?.clientName ?? stop?.clientName ?? 'Orden de trabajo';
  const address = workOrder?.addressLine ?? stop?.addressLine ?? null;
  const coordinates =
    workOrder !== undefined
      ? { lat: workOrder.lat, lng: workOrder.lng }
      : stop
        ? { lat: stop.lat, lng: stop.lng }
        : null;

  return (
    <div className="space-y-4 p-4">
      <div>
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-brand-700" />
          <p className="numeric text-[13px] font-semibold text-brand-700">
            {workOrder?.number ?? `Parada ${stop?.sequence ?? ''}`}
          </p>
        </div>
        <p className="mt-1.5 text-sm font-medium text-ink">{name}</p>
        {address ? <p className="text-xs text-ink-faint">{address}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => coordinates && focusOn(coordinates, 16)}
          disabled={!coordinates}
        >
          Centrar mapa
        </Button>
        <a
          href={`/ordenes/${workOrderId}`}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface-750 px-3 text-[13px] text-ink transition-colors hover:bg-surface-700 sm:h-8 sm:text-xs"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Ver orden completa
        </a>
      </div>
    </div>
  );
}
