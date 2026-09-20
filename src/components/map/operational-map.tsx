'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Building2,
  ClipboardList,
  Filter,
  Gauge,
  Maximize2,
  MinusCircle,
  Minimize2,
  Navigation,
  Power,
  PowerOff,
  Target,
  Truck,
  WifiOff,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  isScoped,
  scopePoints,
  scopeRoutes,
  scopeVehicles,
  type ScopeInput,
} from '@/lib/engines/map-scope';
import { containsPoint } from '@/lib/engines/geofence-engine';
import { FocusBanner } from '@/components/map/focus-banner';
import { ClientFiltersPanel, applyClientFilters } from '@/components/map/client-filters-panel';
import { FleetMap, type FleetMapVehicle } from '@/components/map/fleet-map';
import { LayerControl } from '@/components/map/layer-control';
import { MapViewQuickToggle, ViewModeControl } from '@/components/map/view-mode-control';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Sheet } from '@/components/ui/sheet';
import {
  GpsDegradedNotice,
  PendingIntegrationNotice,
  QueryError,
} from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { OPERATION_BOUNDS } from '@/config/map-viewport';
import { ACTIVITY_COLOR, ACTIVITY_LABEL } from '@/lib/engines/vehicle-activity';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import { mapQuery, communesQuery, systemModeQuery } from '@/hooks/use-control-data';
import { useVehicleTrajectory, type TrajectoryEventType } from '@/hooks/use-vehicle-trajectory';
import { operationPoints } from '@/lib/map-navigation';
import { formatTimeWithSeconds } from '@/lib/format';
import type { TerritoryAnalysis } from '@/types/views';

const DEFAULT_MAX_LEGAL_SPEED_KMH = 60;

const TRAJECTORY_EVENT_STYLE: Record<
  TrajectoryEventType,
  { icon: typeof Gauge; label: string; tone: string }
> = {
  stop: { icon: MinusCircle, label: 'Detencion', tone: 'text-status-warning' },
  speeding: { icon: AlertTriangle, label: 'Exceso de velocidad', tone: 'text-status-dormant' },
  ignition_on: { icon: Power, label: 'Encendido', tone: 'text-status-active' },
  ignition_off: { icon: PowerOff, label: 'Apagado', tone: 'text-ink-faint' },
};

const CommunePanel = dynamic(() => import('@/components/map/commune-panel').then((m) => m.CommunePanel), {
  loading: () => <Skeleton className="h-48 w-full" />,
});

const ClientPanel = dynamic(() => import('@/components/map/client-panel').then((m) => m.ClientPanel), {
  loading: () => <Skeleton className="h-48 w-full" />,
});

const VehiclePanel = dynamic(() => import('@/components/map/vehicle-panel').then((m) => m.VehiclePanel), {
  loading: () => <Skeleton className="h-48 w-full" />,
});

const MapEntityPanel = dynamic(() => import('@/components/map/map-entity-panel').then((m) => m.MapEntityPanel), {
  loading: () => <Skeleton className="h-48 w-full" />,
});

const WorkOrderPanel = dynamic(() => import('@/components/map/work-order-panel').then((m) => m.WorkOrderPanel), {
  loading: () => <Skeleton className="h-48 w-full" />,
});

/**
 * Centro operacional.
 *
 * El mapa ocupa toda la superficie disponible: no es una tarjeta dentro de un
 * panel, es la aplicacion. Los controles flotan encima y las fichas se abren
 * como panel lateral en escritorio y hoja inferior en movil.
 */
export const OperationalMap = memo(function OperationalMap() {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { positions, error: gpsError, lastUpdateAt, refresh } = useLiveFleet();

  // El aviso de GPS/integracion se puede colapsar, pero solo mientras dure
  // ESTA MISMA caida: si la senal se recupera y luego vuelve a fallar, hay
  // que verlo de nuevo. Por eso se reinicia cuando `gpsError` pasa a `true`,
  // no en cada render mientras se mantiene en ese estado.
  const [gpsNoticeDismissed, setGpsNoticeDismissed] = useState(false);
  useEffect(() => {
    if (gpsError) setGpsNoticeDismissed(false);
  }, [gpsError]);

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

  const { data: snapshot, isLoading, isError, error, refetch } = useQuery(mapQuery);

  // El mismo estado que alimenta el indicador del header: distingue una
  // integracion sin configurar (permanente, se arregla en el servidor) de un
  // corte de senal transitorio (se arregla solo, o con "Reintentar").
  const { data: mode } = useQuery(systemModeQuery);

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
  const {
    data: communesData,
    error: communesError,
    refetch: retryCommunes,
  } = useQuery({
    ...communesQuery,
    enabled: layers.comunas || Boolean(inspectedCommuneCode || scopedCommuneCode),
  });

  const communeFeatures = useMemo(
    () =>
      (communesData?.communes ?? []).map((c) => ({
        code: c.code,
        name: c.name,
        center: c.center,
        boundary: c.boundary,
        clients: c.summary?.clients ?? 0,
      })),
    [communesData?.communes],
  );

  const inspectedCommune = useMemo(
    () => communesData?.communes.find((c) => c.code === inspectedCommuneCode) ?? null,
    [communesData, inspectedCommuneCode],
  );

  const allClients = useMemo(() => snapshot?.clients ?? [], [snapshot?.clients]);
  const visibleClients = useMemo(
    () => applyClientFilters(allClients, filters),
    [allClients, filters],
  );

  const vehicles: FleetMapVehicle[] = useMemo(() => {
    if (!snapshot?.vehicles) return [];
    return snapshot.vehicles.map((v) => ({
      vehicleId: v.vehicle.id,
      plate: v.vehicle.plate,
      fleetCode: v.vehicle.fleetCode,
      status: v.activityStatus,
      // La posicion viva del stream tiene prioridad sobre la de la instantanea.
      position: positions.get(v.vehicle.id) ?? v.position,
    }));
  }, [snapshot?.vehicles, positions]);

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
    () => (snapshot?.routes ? scopeRoutes(snapshot.routes, scope) : []),
    [snapshot?.routes, scope],
  );
  const vehiculosEnfocados = useMemo(
    () => scopeVehicles(vehicles, scope, snapshot?.routes ?? []),
    [vehicles, scope, snapshot?.routes],
  );
  const clientesEnfocados = useMemo(
    () => scopePoints(visibleClients, scope, snapshot?.routes ?? []),
    [visibleClients, scope, snapshot?.routes],
  );
  const pedidosEnfocados = useMemo(
    () => scopePoints(snapshot?.pendingWorkOrders ?? [], scope, snapshot?.routes ?? []),
    [snapshot?.pendingWorkOrders, snapshot?.routes, scope],
  );

  const heatmapPoints = useMemo(() => {
    if (!territory) return [];
    return territory.heatmaps[heatmapMode];
  }, [territory, heatmapMode]);

  const followedVehicle = vehicles.find((v) => v.vehicleId === following) ?? null;

  /**
   * Trayecto del dia del vehiculo seleccionado.
   *
   * Se calcula SIEMPRE que hay una seleccion de vehiculo, sin esperar a que
   * el operador pida "seguir" o "centrar": es la pregunta que sigue a
   * seleccionar un camion ("que hizo hoy"), no una accion aparte.
   */
  const selectedVehicleId = currentSelection?.type === 'vehicle' ? currentSelection.id : null;
  const selectedVehiclePlate = useMemo(
    () => (selectedVehicleId ? (vehicles.find((v) => v.vehicleId === selectedVehicleId)?.plate ?? null) : null),
    [vehicles, selectedVehicleId],
  );
  const maxLegalSpeedKmh = mode?.settings.route.maxLegalSpeedKmh ?? DEFAULT_MAX_LEGAL_SPEED_KMH;
  const {
    trajectory: selectedTrajectory,
    isLoading: trajectoryLoading,
    isError: trajectoryError,
  } = useVehicleTrajectory(selectedVehicleId, selectedVehiclePlate, maxLegalSpeedKmh);

  const routesConTrayecto = useMemo(
    () => (selectedTrajectory ? [...routesEnfocadas, selectedTrajectory.route] : routesEnfocadas),
    [routesEnfocadas, selectedTrajectory],
  );

  const trajectoryEventPoints = useMemo(
    () =>
      (selectedTrajectory?.events ?? []).map((event) => ({
        id: event.id,
        eventType: event.type,
        lat: event.position.lat,
        lng: event.position.lng,
      })),
    [selectedTrajectory],
  );

  // El trayecto del dia manda sobre cualquier ruta resaltada mientras el
  // vehiculo siga seleccionado: es lo que el operador vino a ver. Si deja de
  // haber trayecto (se deselecciono, o se cancelo "seguir" sin pasar por
  // `select(null)`) y lo resaltado era ese mismo trayecto sintetico, se
  // limpia: de lo contrario quedaba "pegado" y el banner de enfoque
  // intentaba mostrar su id tecnico como si fuera una ruta real.
  const selectedTrajectoryRouteId = selectedTrajectory?.route.routeId ?? null;
  useEffect(() => {
    if (selectedTrajectoryRouteId) highlightRoute(selectedTrajectoryRouteId);
    else if (highlightedRouteId?.startsWith('trayecto-')) highlightRoute(null);
  }, [selectedTrajectoryRouteId, highlightedRouteId, highlightRoute]);

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedEventId(null);
  }, [selectedVehicleId]);

  const selectedEvent = useMemo(
    () => selectedTrajectory?.events.find((event) => event.id === selectedEventId) ?? null,
    [selectedTrajectory, selectedEventId],
  );

  /** Geocerca (si hay alguna) donde cayo el evento elegido: responde "paso por aqui". */
  const selectedEventGeofence = useMemo(() => {
    if (!selectedEvent || !snapshot) return null;
    return snapshot.geofences.find((g) => g.active && containsPoint(g, selectedEvent.position)) ?? null;
  }, [selectedEvent, snapshot]);

  const openDetail = useCallback(() => setDetailOpen(true), []);

  // Abrir la ficha automaticamente al seleccionar desde el mapa.
  useEffect(() => {
    if (currentSelection) {
      setDetailOpen(true);
    }
  }, [currentSelection]);

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    selection(null);
  }, [selection]);

  const fitOperation = useCallback(() => {
    const store = useMapStore.getState();
    store.showAll();
    const points = snapshot ? operationPoints(snapshot) : [];
    points.push(...vehicles.flatMap((v) => (v.position ? [v.position] : [])));
    if (points.length) store.fitPoints(points);
    else
      focusOn(
        {
          lat: (OPERATION_BOUNDS.minLat + OPERATION_BOUNDS.maxLat) / 2,
          lng: (OPERATION_BOUNDS.minLng + OPERATION_BOUNDS.maxLng) / 2,
        },
        10.4,
      );
  }, [snapshot, vehicles, focusOn]);

  // Pantalla completa dentro de la aplicacion.
  const toggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    if (fullscreen && !document.fullscreenElement) {
      setFullscreen(false);
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      if (!node.requestFullscreen) {
        setFullscreen((value) => !value);
        return;
      }
      void node.requestFullscreen().catch(() => {
        // Algunos navegadores moviles lo bloquean: se degrada al modo interno.
        setFullscreen((value) => !value);
      });
    }
  }, [fullscreen]);

  useEffect(() => {
    const onChange = (): void => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  if (isError && !snapshot) {
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
    detenido: snapshot?.vehicles.filter((v) => v.status === 'detenido').length ?? 0,
    offline: snapshot?.vehicles.filter((v) => v.status === 'offline').length ?? 0,
    // "En observacion": el vehiculo arrastra al menos una alerta abierta,
    // independiente de si sigue en movimiento o esta detenido.
    enObservacion: snapshot?.vehicles.filter((v) => v.openAlertCount > 0).length ?? 0,
    // "OT en curso": el vehiculo tiene una orden de trabajo asignada que esta
    // ejecutando en este momento (no simplemente pendiente de despacho).
    otEnCurso: snapshot?.vehicles.filter((v) => v.activeWorkOrderId !== null).length ?? 0,
  };

  const kpiCards: { key: string; label: string; value: number; icon: typeof Truck; tone: string }[] = [
    { key: 'en-ruta', label: 'En ruta', value: vehicleCounts.enRuta, icon: Truck, tone: 'text-brand-700' },
    { key: 'detenidos', label: 'Detenidos', value: vehicleCounts.detenido, icon: MinusCircle, tone: 'text-status-warning' },
    { key: 'observacion', label: 'En observación', value: vehicleCounts.enObservacion, icon: AlertTriangle, tone: 'text-status-dormant' },
    { key: 'sin-senal', label: 'Sin señal', value: vehicleCounts.offline, icon: WifiOff, tone: 'text-ink-faint' },
    {
      key: 'clientes',
      label: 'Clientes visibles',
      value: layers.clientes ? clientesEnfocados.length : 0,
      icon: Building2,
      tone: 'text-brand-700',
    },
    { key: 'ot-en-curso', label: 'OT en curso', value: vehicleCounts.otEnCurso, icon: ClipboardList, tone: 'text-brand-700' },
  ];

  return (
    <div
      ref={containerRef}
      className={cn('relative h-full w-full bg-surface-950', fullscreen && 'fixed inset-0 z-[70]')}
    >
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
            autoFit
            vehicles={layers.camiones ? vehiculosEnfocados : []}
            clients={clientesEnfocados}
            routes={routesConTrayecto}
            geofences={snapshot.geofences}
            alerts={snapshot.alerts}
            workOrders={pedidosEnfocados}
            communes={communeFeatures}
            heatmapPoints={heatmapPoints}
            trajectoryEvents={trajectoryEventPoints}
            onSelectVehicle={openDetail}
            onSelectClient={openDetail}
            onSelectWorkOrder={openDetail}
            onSelectCommune={inspectCommune}
            onSelectTrajectoryEvent={setSelectedEventId}
          />
        </ErrorBoundary>
      )}

      {/*
        --- Barra superior: resumen KPI y controles ---

        Siempre en dos filas, en cualquier ancho: la fila de KPIs necesita el
        ancho completo para sus seis tarjetas (si comparte fila con los
        controles a la derecha, como se probo antes, le queda tan poco
        espacio que se corta a la mitad y exige scroll horizontal sin ninguna
        pista visual de que hay mas). Los banners de abajo (`top-*`) asumen
        esta misma altura de dos filas en todos los anchos.
      */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-2.5 sm:p-3">
        <div className="pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-md border border-line-strong bg-surface-900/95 p-1 shadow-float backdrop-blur sm:gap-1.5">
          {kpiCards.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <div
                key={kpi.key}
                className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 text-2xs"
              >
                <Icon className={cn('h-3.5 w-3.5', kpi.tone)} />
                <span className="numeric font-medium text-ink">{kpi.value}</span>
                <span className="text-ink-faint">{kpi.label}</span>
              </div>
            );
          })}
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtros del mapa"
            className="tap relative flex items-center gap-2 rounded-md border border-line-strong bg-surface-900/95 px-3 text-[13px] text-ink shadow-float backdrop-blur transition-colors hover:border-brand-500 sm:h-9 sm:min-h-0"
          >
            <Filter className="h-4 w-4 text-brand-700" />
            <span className="hidden sm:inline">Filtros</span>
            {activeFilterCount > 0 ? (
              <Badge tone="brand" size="sm">
                {activeFilterCount}
              </Badge>
            ) : null}
          </button>

          <LayerControl />
          <MapViewQuickToggle />
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

      {isError || (layers.comunas && communesError) ? (
        <div
          role="alert"
          className="absolute left-3 right-3 top-28 z-20 rounded-md border border-status-warning/30 bg-surface-900 p-3 text-xs text-status-warning"
        >
          {isError
            ? 'No se pudo actualizar la operación. Se conservan los últimos datos.'
            : 'No se pudieron cargar las comunas.'}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              void refetch();
              void retryCommunes();
            }}
          >
            Reintentar
          </button>
        </div>
      ) : null}
      {/*
        --- Aviso de degradacion GPS ---

        `top-28`: la barra superior siempre ocupa dos filas (KPIs arriba,
        controles debajo) en cualquier ancho, asi que un solo offset alcanza
        para todos los tamanos de pantalla. Con uno menor este aviso se
        dibujaba encima de "Filtros/Capas/Vista" y les robaba el clic sin que
        se notara visualmente por que dejaban de responder.

        `z-[5]` (menor que el `z-10` de la barra de controles): con el mismo
        z-index, el orden del DOM decidia el empate a favor de este aviso (va
        despues en el marcado) y tapaba tanto la barra como lo que esta
        despliega (el desplegable de Capas/Vista), aunque ese desplegable
        tuviera su propio z-index mayor: ese z-index solo cuenta dentro del
        contexto de apilamiento de la barra, no frente a un hermano con el
        mismo nivel que ella.
      */}
      {gpsError && !gpsNoticeDismissed ? (
        <div className="pointer-events-auto absolute inset-x-2.5 top-28 z-[5] sm:inset-x-auto sm:left-1/2 sm:w-[440px] sm:-translate-x-1/2">
          {mode?.gps.provider === 'unavailable' ? (
            <PendingIntegrationNotice
              onDismiss={() => setGpsNoticeDismissed(true)}
              what={
                <>
                  La flota no aparece en el mapa: el proveedor de telemetria GPS no esta conectado.
                  Requiere credenciales en el servidor.{' '}
                  <a href="/configuracion" className="font-medium underline">
                    Ver estado del sistema
                  </a>
                  .
                </>
              }
            />
          ) : (
            <GpsDegradedNotice
              lastKnownAt={lastUpdateAt}
              onRetry={refresh}
              onDismiss={() => setGpsNoticeDismissed(true)}
            />
          )}
        </div>
      ) : null}

      <Sheet
        open={Boolean(inspectedCommune)}
        onClose={() => inspectCommune(null)}
        title="Detalle de comuna"
        transparentOverlay
      >
        {inspectedCommune ? (
          <div className="flex justify-center p-3">
            <CommunePanel commune={inspectedCommune} onClose={() => inspectCommune(null)} />
          </div>
        ) : null}
      </Sheet>

      {/* --- Que se esta mirando --- */}
      {scopeActivo ||
      currentSelection?.type === 'vehicle' ||
      highlightedRouteId ||
      scopedCommuneCode ? (
        <div className="absolute bottom-24 left-2.5 z-20 sm:bottom-4">
          <FocusBanner
            vehiclePlate={
              currentSelection?.type === 'vehicle'
                ? (vehicles.find((v) => v.vehicleId === currentSelection.id)?.plate ?? null)
                : null
            }
            vehicleFleetCode={
              currentSelection?.type === 'vehicle'
                ? (vehicles.find((v) => v.vehicleId === currentSelection.id)?.fleetCode ?? null)
                : null
            }
            routeCode={
              // El trayecto del dia del vehiculo seleccionado tambien resalta
              // via `highlightedRouteId`, pero no es una "ruta" que mostrar
              // aparte: seria un chip redundante con el del propio vehiculo.
              highlightedRouteId && highlightedRouteId !== selectedTrajectory?.route.routeId
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
          {selectedVehicleId && trajectoryLoading ? (
            <p className="mt-1.5 text-2xs text-ink-faint">Cargando trayecto del dia...</p>
          ) : selectedVehicleId && trajectoryError ? (
            <p className="mt-1.5 text-2xs text-status-warning">
              No fue posible cargar el trayecto del dia de este vehiculo.
            </p>
          ) : null}
        </div>
      ) : null}

      {/*
        --- Detalle del evento del trayecto seleccionado ---
        Se apila ARRIBA de la barra de seguimiento (`bottom-[132px]` en vez
        de `bottom-[70px]`): con un vehiculo seguido y un evento de su propio
        trayecto elegido a la vez, ambas franjas conviven sin superponerse.
      */}
      {selectedEvent ? (
        <div className="pointer-events-auto safe-bottom absolute inset-x-2.5 bottom-[132px] z-20 flex items-start gap-3 rounded-lg border border-line-strong bg-surface-900/97 px-3 py-2.5 shadow-panel backdrop-blur sm:inset-x-auto sm:bottom-20 sm:left-1/2 sm:w-[420px] sm:-translate-x-1/2">
          {(() => {
            const style = TRAJECTORY_EVENT_STYLE[selectedEvent.type];
            const Icon = style.icon;
            return (
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-800', style.tone)}>
                <Icon className="h-4 w-4" />
              </span>
            );
          })()}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">
              {TRAJECTORY_EVENT_STYLE[selectedEvent.type].label}
              <span className="ml-2 numeric text-2xs font-normal text-ink-faint">
                {formatTimeWithSeconds(selectedEvent.at)}
                {selectedEvent.endedAt ? ` – ${formatTimeWithSeconds(selectedEvent.endedAt)}` : ''}
              </span>
            </p>
            <p className="truncate text-2xs text-ink-muted">{selectedEvent.detail}</p>
            <p className="mt-0.5 truncate text-2xs text-ink-faint">
              {selectedEventGeofence
                ? `Dentro de la geocerca "${selectedEventGeofence.name}"`
                : 'Fuera de cualquier geocerca activa en este punto'}
            </p>
          </div>

          <Button size="sm" variant="secondary" onClick={() => setSelectedEventId(null)}>
            Cerrar
          </Button>
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

      {/* --- Leyenda de estados de vehiculos --- */}
      {layers.camiones ? (
        <div className="pointer-events-none absolute bottom-[132px] right-2.5 z-10 hidden flex-col gap-1 rounded-md border border-line bg-surface-900/90 px-2.5 py-2 text-2xs shadow-float backdrop-blur lg:flex lg:bottom-52 lg:right-14">
          <p className="mb-0.5 font-semibold uppercase tracking-wider text-ink-faint">
            Estados de vehículos
          </p>
          {(Object.keys(ACTIVITY_LABEL) as (keyof typeof ACTIVITY_LABEL)[]).map((status) => (
            <span key={status} className="flex items-center gap-1.5 text-ink-muted">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: ACTIVITY_COLOR[status] }}
              />
              {ACTIVITY_LABEL[status]}
            </span>
          ))}
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
              : currentSelection?.type === 'geofence'
                ? 'Detalle de geocerca'
                : currentSelection?.type === 'route'
                  ? 'Detalle de ruta'
                  : currentSelection?.type === 'alert'
                    ? 'Detalle de alerta'
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
            <WorkOrderPanel workOrderId={currentSelection.id} snapshot={snapshot ?? null} />
          ) : currentSelection ? (
            <MapEntityPanel selection={currentSelection} snapshot={snapshot ?? null} />
          ) : null}
        </ErrorBoundary>
      </Sheet>
    </div>
  );
});
