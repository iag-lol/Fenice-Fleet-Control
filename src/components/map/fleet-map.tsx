'use client';

import maplibregl, { type Map as MapLibreMap, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { registerMapIcons } from '@/components/map/map-icons';
import {
  boundsToLngLatBounds,
  LAYER,
  registerLayers,
  setLayerVisibility,
  SOURCE,
  updateAlerts,
  updateClients,
  updateCommunes,
  updateFollowTrail,
  updateGeofences,
  updateHeatmap,
  updateRoutes,
  updateVehicles,
  updateWorkOrders,
  type CommuneFeatureInput,
  type VehicleFeatureInput,
} from '@/components/map/map-layers';
import { resolveMapStyle } from '@/components/map/map-style';
import { OPERATION_BOUNDS, OPERATION_CENTER } from '@/data/communes';
import { useMapStore, type MapLayerId } from '@/stores/map-store';
import type { Geofence, HeatmapPoint, LatLng, Position } from '@/types/core';
import type {
  AlertMapPoint,
  ClientMapPoint,
  RouteGeometry,
  WorkOrderMapPoint,
} from '@/types/views';

/**
 * Mapa operacional.
 *
 * Responsable de: instancia de MapLibre, animacion de marcadores, encuadres,
 * visibilidad de capas e interacciones. Los datos llegan ya calculados; este
 * componente no decide estados ni evalua reglas.
 */

export interface FleetMapVehicle {
  vehicleId: string;
  plate: string;
  fleetCode: string;
  /** Estado de actividad: decide el color del camion. */
  status: string;
  position: Position | null;
}

export interface FleetMapProps {
  vehicles: FleetMapVehicle[];
  clients: ClientMapPoint[];
  routes: RouteGeometry[];
  geofences: Geofence[];
  alerts: AlertMapPoint[];
  workOrders: WorkOrderMapPoint[];
  communes: CommuneFeatureInput[];
  heatmapPoints: HeatmapPoint[];
  onSelectVehicle?: (vehicleId: string) => void;
  onSelectClient?: (clientId: string) => void;
  onSelectWorkOrder?: (workOrderId: string) => void;
  onSelectCommune?: (communeCode: string) => void;
  className?: string;
  /** Oculta los controles nativos cuando el contenedor aporta los suyos. */
  minimalControls?: boolean;
  /**
   * Fija la visibilidad de capas para este mapa concreto.
   *
   * Los mapas embebidos (detalle de vehiculo, de ruta, de cliente, analisis
   * territorial) tienen un proposito fijo y no deben verse afectados por lo
   * que el usuario haya activado o desactivado en el mapa operacional.
   */
  layerOverride?: Partial<Record<MapLayerId, boolean>>;
  /**
   * Entrega la instancia de MapLibre cuando esta lista.
   *
   * Lo necesita el editor de geocercas, que dibuja sus propias capas de
   * previsualizacion sobre el mismo mapa. Se expone por callback y no por ref
   * para que el consumidor sepa CUANDO puede empezar a usarla.
   */
  onMapReady?: (map: MapLibreMap) => void;
  /**
   * Encuadra el mapa sobre su contenido al cargarlo.
   *
   * Los mapas embebidos (ficha de vehiculo, de ruta, reproduccion) abrian en
   * la vista general de Santiago, donde un solo camion es un punto de dos
   * pixeles perdido entre calles: parecia que no se dibujaba. Con esto el
   * mapa empieza mirando lo que tiene que mostrar.
   *
   * NO se aplica al mapa operacional, cuya vista general es intencionada.
   */
  autoFit?: boolean;
}

interface AnimatedVehicle {
  current: { lat: number; lng: number; heading: number };
  target: { lat: number; lng: number; heading: number };
  status: string;
  moving: boolean;
  plate: string;
  fleetCode: string;
}

/** Interpolacion angular por el camino corto: evita giros de 350 grados. */
function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return (from + delta * t + 360) % 360;
}

export function FleetMap({
  autoFit = false,
  vehicles,
  clients,
  routes,
  geofences,
  alerts,
  workOrders,
  communes,
  heatmapPoints,
  onSelectVehicle,
  onSelectClient,
  onSelectWorkOrder,
  onSelectCommune,
  className,
  minimalControls,
  layerOverride,
  onMapReady,
}: FleetMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const animatedRef = useRef<Map<string, AnimatedVehicle>>(new Map());
  const frameRef = useRef<number | null>(null);
  const trailRef = useRef<LatLng[]>([]);
  const [ready, setReady] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  const layers = useMapStore((s) => s.layers);
  const selection = useMapStore((s) => s.selection);
  const select = useMapStore((s) => s.select);
  const following = useMapStore((s) => s.followingVehicleId);
  const focus = useMapStore((s) => s.focus);
  const highlightedRouteId = useMapStore((s) => s.highlightedRouteId);

  const selectedClientId = selection?.type === 'client' ? selection.id : null;
  const selectedVehicleId = selection?.type === 'vehicle' ? selection.id : null;

  const viewMode = useMapStore((s) => s.viewMode);
  const resolved = useMemo(() => resolveMapStyle(viewMode), [viewMode]);

  // --- Inicializacion ------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolved.style,
      center: [OPERATION_CENTER.lng, OPERATION_CENTER.lat],
      zoom: 10.4,
      minZoom: 6,
      maxZoom: 18,
      attributionControl: { compact: true },
      // Rendimiento: no se necesitan capturas del canvas.
      preserveDrawingBuffer: false,
      dragRotate: false,
      pitchWithRotate: false,
    });

    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    if (!minimalControls) {
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
        }),
        'bottom-right',
      );
      map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
    }

    const onLoad = (): void => {
      try {
        registerMapIcons(map);
        registerLayers(map);
        setReady(true);
      } catch (error) {
        setStyleError(error instanceof Error ? error.message : String(error));
      }
    };

    map.on('load', onLoad);

    /**
     * El gesto del operador manda sobre el seguimiento automatico.
     *
     * Mientras se sigue a un camion la camara se reposiciona en cada cuadro.
     * Sin esto, arrastrar el mapa era imposible: la vista volvia sola al
     * vehiculo y parecia que el mapa estaba bloqueado. En cuanto el operador
     * mueve, hace zoom o gira, se suelta el seguimiento y el mapa vuelve a
     * ser suyo.
     *
     * Se comprueba `originalEvent` para distinguir el gesto humano de los
     * desplazamientos que provoca el propio seguimiento.
     */
    const soltarSeguimiento = (event: { originalEvent?: unknown }): void => {
      if (!event.originalEvent) return;
      if (useMapStore.getState().followingVehicleId === null) return;
      useMapStore.getState().followVehicle(null);
    };

    map.on('dragstart', soltarSeguimiento);
    map.on('zoomstart', soltarSeguimiento);
    map.on('rotatestart', soltarSeguimiento);

    map.on('error', (event) => {
      // Un tile que falla no debe romper el mapa; solo se registra.
      console.warn('[mapa]', event.error?.message ?? 'error desconocido');
    });

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // El estilo se recrea al cambiar de modo de vista: MapLibre descarta las
    // capas propias con el estilo, y volver a registrarlas es mas fiable que
    // intentar preservarlas.
  }, [resolved.style, minimalControls]);

  // El consumidor recibe el mapa solo cuando fuentes y capas ya existen.
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    onMapReady?.(mapRef.current);
  }, [ready, onMapReady]);

  // --- Interacciones -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const onVehicleClick = (event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void => {
      const vehicleId = event.features?.[0]?.properties?.['vehicleId'];
      if (typeof vehicleId === 'string') {
        select({ type: 'vehicle', id: vehicleId });
        onSelectVehicle?.(vehicleId);
      }
    };

    const onClientClick = (event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void => {
      const clientId = event.features?.[0]?.properties?.['clientId'];
      if (typeof clientId === 'string') {
        select({ type: 'client', id: clientId });
        onSelectClient?.(clientId);
      }
    };

    const onWorkOrderClick = (event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void => {
      const workOrderId = event.features?.[0]?.properties?.['workOrderId'];
      if (typeof workOrderId === 'string') {
        select({ type: 'workOrder', id: workOrderId });
        onSelectWorkOrder?.(workOrderId);
      }
    };

    const onStopClick = (event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void => {
      const workOrderId = event.features?.[0]?.properties?.['workOrderId'];
      if (typeof workOrderId === 'string') onSelectWorkOrder?.(workOrderId);
    };

    // Al tocar un grupo, acercar hasta expandirlo: es la accion que el
    // operador espera y evita tener que adivinar el nivel de zoom.
    const onClusterClick = (event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }): void => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.['cluster_id'];
      if (clusterId === undefined) return;

      const source = map.getSource(SOURCE.clients) as maplibregl.GeoJSONSource;
      void source.getClusterExpansionZoom(Number(clusterId)).then((zoom) => {
        const geometry = feature?.geometry;
        if (geometry?.type !== 'Point') return;
        map.easeTo({
          center: geometry.coordinates as [number, number],
          zoom: Math.min(zoom + 0.2, 17),
          duration: 500,
        });
      });
    };

    // --- Comunas: resaltado bajo el cursor y apertura del panel -------------
    let hoveredCommune: number | string | null = null;

    const clearCommuneHover = (): void => {
      if (hoveredCommune === null) return;
      map.setFeatureState({ source: SOURCE.communes, id: hoveredCommune }, { hover: false });
      hoveredCommune = null;
    };

    const onCommuneMove = (
      event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ): void => {
      const feature = event.features?.[0];
      if (feature?.id === undefined) return;
      if (hoveredCommune === feature.id) return;

      clearCommuneHover();
      hoveredCommune = feature.id;
      map.setFeatureState({ source: SOURCE.communes, id: feature.id }, { hover: true });
      map.getCanvas().style.cursor = 'pointer';
    };

    const onCommuneLeave = (): void => {
      clearCommuneHover();
      map.getCanvas().style.cursor = '';
    };

    const onCommuneClick = (
      event: MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] },
    ): void => {
      const code = event.features?.[0]?.properties?.['code'];
      if (typeof code === 'string') onSelectCommune?.(code);
    };

    map.on('mousemove', LAYER.communesFill, onCommuneMove);
    map.on('mouseleave', LAYER.communesFill, onCommuneLeave);
    map.on('click', LAYER.communesFill, onCommuneClick);

    const pointerOn = (): void => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const pointerOff = (): void => {
      map.getCanvas().style.cursor = '';
    };

    const interactive = [
      LAYER.vehicles,
      LAYER.clientPoints,
      LAYER.clientClusters,
      LAYER.workOrders,
      LAYER.routeStops,
    ];

    map.on('click', LAYER.vehicles, onVehicleClick);
    map.on('click', LAYER.clientPoints, onClientClick);
    map.on('click', LAYER.clientClusters, onClusterClick);
    map.on('click', LAYER.workOrders, onWorkOrderClick);
    map.on('click', LAYER.routeStops, onStopClick);

    for (const layer of interactive) {
      map.on('mouseenter', layer, pointerOn);
      map.on('mouseleave', layer, pointerOff);
    }

    return () => {
      map.off('mousemove', LAYER.communesFill, onCommuneMove);
      map.off('mouseleave', LAYER.communesFill, onCommuneLeave);
      map.off('click', LAYER.communesFill, onCommuneClick);
      map.off('click', LAYER.vehicles, onVehicleClick);
      map.off('click', LAYER.clientPoints, onClientClick);
      map.off('click', LAYER.clientClusters, onClusterClick);
      map.off('click', LAYER.workOrders, onWorkOrderClick);
      map.off('click', LAYER.routeStops, onStopClick);
      for (const layer of interactive) {
        map.off('mouseenter', layer, pointerOn);
        map.off('mouseleave', layer, pointerOff);
      }
    };
  }, [ready, select, onSelectVehicle, onSelectClient, onSelectWorkOrder, onSelectCommune]);

  // --- Animacion de vehiculos ----------------------------------------------
  /**
   * Los equipos reportan cada 15-30 s. Pintar cada posicion directamente
   * produciria saltos. Se interpola hacia el objetivo en cada frame para que
   * el movimiento se lea como desplazamiento continuo.
   */
  useEffect(() => {
    const animated = animatedRef.current;
    const seen = new Set<string>();

    for (const vehicle of vehicles) {
      if (!vehicle.position) continue;
      seen.add(vehicle.vehicleId);

      const target = {
        lat: vehicle.position.lat,
        lng: vehicle.position.lng,
        heading: vehicle.position.heading,
      };
      // Solo el camion en movimiento muestra su orientacion; uno detenido
      // apuntando a un rumbo antiguo confundiria al operador.
      const moving = vehicle.status === 'moving' || vehicle.status === 'deviated';
      const existing = animated.get(vehicle.vehicleId);

      if (!existing) {
        animated.set(vehicle.vehicleId, {
          current: { ...target },
          target,
          status: vehicle.status,
          moving,
          plate: vehicle.plate,
          fleetCode: vehicle.fleetCode,
        });
      } else {
        existing.target = target;
        existing.status = vehicle.status;
        existing.moving = moving;
        existing.plate = vehicle.plate;
        existing.fleetCode = vehicle.fleetCode;
      }
    }

    for (const key of [...animated.keys()]) {
      if (!seen.has(key)) animated.delete(key);
    }
  }, [vehicles]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    if (!map) return;

    let running = true;

    const step = (): void => {
      if (!running) return;
      const animated = animatedRef.current;
      const features: VehicleFeatureInput[] = [];
      let needsFrame = false;

      for (const [vehicleId, state] of animated) {
        const latDelta = state.target.lat - state.current.lat;
        const lngDelta = state.target.lng - state.current.lng;
        const distance = Math.hypot(latDelta, lngDelta);

        if (distance > 0.0000015) {
          // Suavizado exponencial: rapido al inicio, asintotico al final.
          state.current.lat += latDelta * 0.12;
          state.current.lng += lngDelta * 0.12;
          needsFrame = true;
        } else {
          state.current.lat = state.target.lat;
          state.current.lng = state.target.lng;
        }

        const headingDelta = Math.abs(
          ((((state.target.heading - state.current.heading) % 360) + 540) % 360) - 180,
        );
        if (headingDelta > 0.6) {
          state.current.heading = lerpAngle(state.current.heading, state.target.heading, 0.14);
          needsFrame = true;
        } else {
          state.current.heading = state.target.heading;
        }

        features.push({
          vehicleId,
          plate: state.plate,
          fleetCode: state.fleetCode,
          lat: state.current.lat,
          lng: state.current.lng,
          heading: state.current.heading,
          status: state.status,
          moving: state.moving,
          selected: vehicleId === selectedVehicleId,
        });
      }

      updateVehicles(map, features);

      // Camara adherida al vehiculo seguido.
      if (following) {
        const state = animatedRef.current.get(following);
        if (state) {
          map.easeTo({
            center: [state.current.lng, state.current.lat],
            duration: 220,
            essential: true,
          });

          const trail = trailRef.current;
          const last = trail[trail.length - 1];
          if (!last || Math.hypot(last.lat - state.current.lat, last.lng - state.current.lng) > 0.00008) {
            trail.push({ lat: state.current.lat, lng: state.current.lng });
            if (trail.length > 300) trail.shift();
            updateFollowTrail(map, trail);
          }
        }
      }

      frameRef.current = needsFrame || following ? requestAnimationFrame(step) : null;
    };

    frameRef.current = requestAnimationFrame(step);

    // Redibujar cuando lleguen posiciones nuevas aunque la animacion se
    // hubiera detenido por haber alcanzado el objetivo.
    const restart = setInterval(() => {
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(step);
    }, 500);

    return () => {
      running = false;
      clearInterval(restart);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [ready, following, selectedVehicleId]);

  // Limpiar la estela al dejar de seguir.
  useEffect(() => {
    if (following) return;
    trailRef.current = [];
    const map = mapRef.current;
    if (map && ready) updateFollowTrail(map, []);
  }, [following, ready]);

  // --- Datos de capas ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateClients(map, clients, selectedClientId);
  }, [ready, clients, selectedClientId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateRoutes(map, routes, highlightedRouteId);
  }, [ready, routes, highlightedRouteId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateGeofences(map, geofences);
  }, [ready, geofences]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateAlerts(map, alerts);
  }, [ready, alerts]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateWorkOrders(map, workOrders);
  }, [ready, workOrders]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateCommunes(map, communes);
  }, [ready, communes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateHeatmap(map, heatmapPoints);
  }, [ready, heatmapPoints]);

  // --- Visibilidad de capas ------------------------------------------------
  const effectiveLayers = useMemo(
    () => ({ ...layers, ...layerOverride }),
    [layers, layerOverride],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    setLayerVisibility(
      map,
      [LAYER.vehicles, LAYER.vehicleLabels, LAYER.vehiclePulse],
      effectiveLayers.camiones,
    );
    setLayerVisibility(
      map,
      [LAYER.clientPoints, LAYER.clientLabels, LAYER.clientClusters, LAYER.clientClusterCount],
      effectiveLayers.clientes,
    );
    setLayerVisibility(
      map,
      [LAYER.routePlanned, LAYER.routeExecuted, LAYER.routeStops, LAYER.routeStopLabels],
      effectiveLayers.rutas,
    );
    setLayerVisibility(map, [LAYER.geofenceFill, LAYER.geofenceLine], effectiveLayers.geocercas);
    setLayerVisibility(map, [LAYER.heatmap], effectiveLayers.calor);
    setLayerVisibility(map, [LAYER.workOrders], effectiveLayers.pedidos);
    setLayerVisibility(map, [LAYER.alerts], effectiveLayers.alertas);
    setLayerVisibility(
      map,
      [LAYER.communesFill, LAYER.communesLine, LAYER.communesLabel],
      effectiveLayers.comunas,
    );
  }, [ready, effectiveLayers]);

  /**
   * Encuadre inicial sobre el contenido.
   *
   * Se ejecuta UNA sola vez, cuando llega el primer contenido con coordenadas.
   * Reencuadrar en cada actualizacion pelearia con el operador: bastaria que
   * el camion se moviera para que el mapa saltara mientras se intenta mirar
   * otra cosa.
   */
  const autoFitDone = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !autoFit || autoFitDone.current) return;

    const puntos: [number, number][] = [];
    for (const vehicle of vehicles) {
      if (vehicle.position) puntos.push([vehicle.position.lng, vehicle.position.lat]);
    }
    for (const route of routes) {
      for (const p of route.plannedPath) puntos.push([p.lng, p.lat]);
      for (const stop of route.stops) puntos.push([stop.lng, stop.lat]);
    }
    for (const client of clients) puntos.push([client.lng, client.lat]);
    if (puntos.length === 0) return;

    autoFitDone.current = true;

    // Un solo punto no tiene extension: se centra a un zoom de calle, que es
    // lo util para ver donde esta exactamente un camion.
    if (puntos.length === 1) {
      map.jumpTo({ center: puntos[0]!, zoom: 15 });
      return;
    }

    let [oeste, sur] = puntos[0]!;
    let [este, norte] = puntos[0]!;
    for (const [lng, lat] of puntos) {
      oeste = Math.min(oeste, lng);
      este = Math.max(este, lng);
      sur = Math.min(sur, lat);
      norte = Math.max(norte, lat);
    }

    map.fitBounds(
      [
        [oeste, sur],
        [este, norte],
      ],
      { padding: 64, maxZoom: 15.5, duration: 0 },
    );
  }, [ready, autoFit, vehicles, routes, clients]);

  // --- Encuadre solicitado -------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;

    map.flyTo({
      center: [focus.center.lng, focus.center.lat],
      zoom: focus.zoom ?? 15,
      duration: 900,
      essential: true,
    });
  }, [ready, focus]);

  const fitOperation = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(boundsToLngLatBounds(OPERATION_BOUNDS), { padding: 48, duration: 700 });
  }, []);

  // Expuesto por atributo de datos para que el contenedor pueda invocarlo.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    (node as HTMLDivElement & { __fitOperation?: () => void }).__fitOperation = fitOperation;
  }, [fitOperation]);

  return (
    <div className={className}>
      <div ref={containerRef} className="h-full w-full" data-testid="fleet-map" />

      {styleError ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 rounded-md border border-status-dormant/30 bg-surface-900/95 px-3 py-2 text-xs text-status-dormant">
          No fue posible inicializar el mapa: {styleError}
        </div>
      ) : null}

      {resolved.fallbackReason ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-line bg-surface-900/85 px-2 py-1 text-2xs text-ink-faint">
          {resolved.fallbackReason} Usando {resolved.provider.label}.
        </div>
      ) : null}
    </div>
  );
}
