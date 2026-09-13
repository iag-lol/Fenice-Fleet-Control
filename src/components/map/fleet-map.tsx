'use client';

import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, MapMouseEvent, RasterTileSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';

import { registerMapIcons } from '@/components/map/map-icons';
import {
  boundsToLngLatBounds,
  LAYER,
  registerClientLayers,
  registerLayers,
  removeClientLayers,
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
import { OPERATION_CENTER } from '@/config/map-viewport';
import { pointOnRoad, roadPathForTransition } from '@/lib/gps-motion';
import { startMapAnimationLoop } from '@/lib/map-animation-loop';
import { isUsableCoordinate } from '@/lib/geo';
import { geofencePoints } from '@/lib/map-navigation';
import { useMapStore, type MapLayerId } from '@/stores/map-store';
import type { Geofence, HeatmapPoint, LatLng, Position } from '@/types/core';
import type {
  AlertMapPoint,
  ClientMapPoint,
  RouteGeometry,
  WorkOrderMapPoint,
} from '@/types/views';

/**
 * MapLibre 6.x carga su worker con `new Worker(new URL(..., import.meta.url))`,
 * un patron pensado para Vite/esbuild. El bundler de Next (Webpack, incluso
 * con `transpilePackages`) no lo resuelve: la URL termina apuntando a una
 * ruta que no existe, Next responde su pagina 404 en HTML, y el navegador
 * rechaza el worker por MIME type ("non-JavaScript MIME type of text/html").
 * Sin el worker, el mapa base (tiles raster) se ve normal porque no lo
 * necesita, pero NINGUNA capa vectorial (clientes, vehiculos, rutas,
 * geocercas...) llega a pintarse: su proceso de tiling nunca corre.
 *
 * El fix es apuntar el worker a una copia servida como estatico desde
 * `public/maplibre/` (fuera del pipeline de Webpack), via la API que la
 * propia libreria expone para este caso. Debe ejecutarse antes de crear
 * cualquier `Map`, por eso vive a nivel de modulo.
 */
maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.js');

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
  sample: Position;
  path: LatLng[] | null;
  animateUntil: number;
  current: { lat: number; lng: number; heading: number };
  target: { lat: number; lng: number; heading: number };
  /** Punto de partida del tramo en curso: permite interpolar linealmente en vez de a saltos. */
  segmentStart: { lat: number; lng: number; heading: number };
  /** `performance.now()` de cuando se fijo el target actual. */
  segmentStartedAt: number;
  /** Cuanto deberia tardar en llegar al target, estimado del intervalo real entre reportes. */
  segmentDurationMs: number;
  status: string;
  moving: boolean;
  plate: string;
  fleetCode: string;
}

/**
 * Duracion del tramo de interpolacion.
 *
 * Se estima con el intervalo real entre las dos ultimas posiciones: si el
 * equipo reporta cada 15 s, el marcador tarda 15 s en deslizarse de un punto
 * al siguiente, en vez de saltar en menos de un segundo y quedarse quieto
 * el resto. Acotado hacia arriba para no inventar un trayecto de varios
 * minutos cuando el equipo estuvo un rato sin reportar (el vehiculo pudo
 * haber girado varias veces en ese hueco; una linea recta larga mentiria
 * sobre su recorrido real). Acotado hacia abajo para que el simulador, que
 * reporta cada 1-2 s, se siga viendo fluido.
 */
const MIN_SEGMENT_MS = 800;
const MAX_SEGMENT_MS = 20_000;
/** Duracion por defecto cuando aun no hay dos reportes para estimar el intervalo real. */
const DEFAULT_SEGMENT_MS = 3_000;

/** Progreso 0-1 con suavizado en ambos extremos: arranca y frena, no se mueve a velocidad constante y en seco. */
function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
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
  const cameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const animatedRef = useRef<Map<string, AnimatedVehicle>>(new Map());
  const trailRef = useRef<LatLng[]>([]);
  const stopAnimationRef = useRef<(() => void) | null>(null);
  const clusterAplicado = useRef(true);
  const inspectedCommuneCode = useMapStore((s) => s.inspectedCommuneCode);
  const [ready, setReady] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);

  const layers = useMapStore((s) => s.layers);
  const trafficEnabled = useMapStore((s) => s.trafficEnabled);
  const clusterClients = useMapStore((s) => s.clusterClients);
  const selection = useMapStore((s) => s.selection);
  const select = useMapStore((s) => s.select);
  const following = useMapStore((s) => s.followingVehicleId);
  const focus = useMapStore((s) => s.focus);
  const highlightedRouteId = useMapStore((s) => s.highlightedRouteId);

  const selectedClientId = selection?.type === 'client' ? selection.id : null;
  const selectedVehicleId = selection?.type === 'vehicle' ? selection.id : null;
  const selectedGeofenceId = selection?.type === 'geofence' ? selection.id : null;
  const selectedAlertId = selection?.type === 'alert' ? selection.id : null;

  const viewMode = useMapStore((s) => s.viewMode);
  const resolved = useMemo(() => resolveMapStyle(viewMode), [viewMode]);

  // --- Inicializacion ------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: resolved.style,
      center: cameraRef.current?.center ?? [OPERATION_CENTER.lng, OPERATION_CENTER.lat],
      zoom: cameraRef.current?.zoom ?? 10.4,
      minZoom: 6,
      maxZoom: 18,
      attributionControl: { compact: true },
      // Rendimiento: no se necesitan capturas del canvas (ya es el valor por
      // defecto de la libreria; se deja explicito para que quede documentado).
      canvasContextAttributes: { preserveDrawingBuffer: false },
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
        setStyleError(null);
        clusterAplicado.current = true;
        registerMapIcons(map);
        registerLayers(map);
        setReady(true);
      } catch (error) {
        setStyleError(error instanceof Error ? error.message : String(error));
      }
    };

    map.on('load', onLoad);
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(containerRef.current);

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
      stopAnimationRef.current?.();
      resizeObserver.disconnect();
      const center = map.getCenter();
      cameraRef.current = { center: [center.lng, center.lat], zoom: map.getZoom() };
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

    // Resolve a single topmost operational entity. Independent delegated
    // listeners also selected the commune underneath every truck or client.
    const priority = [
      LAYER.vehicles,
      LAYER.vehicleLabels,
      LAYER.clientPoints,
      LAYER.clientLabels,
      LAYER.clientClusters,
      LAYER.clientClusterCount,
      LAYER.workOrders,
      LAYER.routeStops,
      LAYER.routeStopLabels,
      LAYER.alerts,
      LAYER.geofenceLine,
      LAYER.geofenceLabel,
      LAYER.routeExecuted,
      LAYER.routePlanned,
      LAYER.geofenceFill,
      LAYER.communesLabel,
      LAYER.communesLine,
      LAYER.communesFill,
    ];
    const hitAt = (event: MapMouseEvent) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: priority.filter((id) => Boolean(map.getLayer(id))),
      });
      return priority.flatMap((id) => features.filter((f) => f.layer.id === id))[0];
    };
    const onClick = (event: MapMouseEvent): void => {
      const feature = hitAt(event);
      if (!feature) return;
      const props = feature.properties;
      const layer = feature.layer.id;
      if (layer === LAYER.clientClusters || layer === LAYER.clientClusterCount) {
        const source = map.getSource(SOURCE.clients) as maplibregl.GeoJSONSource;
        void source
          .getClusterExpansionZoom(Number(props['cluster_id']))
          .then((zoom) => {
            if (mapRef.current !== map || feature.geometry.type !== 'Point') return;
            useMapStore.setState({ followingVehicleId: null });
            map.easeTo({
              center: feature.geometry.coordinates as [number, number],
              zoom: Math.min(zoom + 0.2, 17),
              duration: 500,
            });
          })
          .catch(() => {
            /* The source may have changed while expanding a cluster. */
          });
        return;
      }
      if (
        layer === LAYER.communesFill ||
        layer === LAYER.communesLine ||
        layer === LAYER.communesLabel
      ) {
        if (typeof props['code'] === 'string') onSelectCommune?.(props['code']);
        return;
      }
      if (typeof props['vehicleId'] === 'string') {
        select({ type: 'vehicle', id: props['vehicleId'] });
        onSelectVehicle?.(props['vehicleId']);
      } else if (typeof props['clientId'] === 'string') {
        select({ type: 'client', id: props['clientId'] });
        onSelectClient?.(props['clientId']);
      } else if (typeof props['workOrderId'] === 'string') {
        select({ type: 'workOrder', id: props['workOrderId'] });
        onSelectWorkOrder?.(props['workOrderId']);
      } else if (typeof props['alertId'] === 'string') {
        select({ type: 'alert', id: props['alertId'] });
      } else if (typeof props['geofenceId'] === 'string') {
        select({ type: 'geofence', id: props['geofenceId'] });
      } else if (typeof props['routeId'] === 'string') {
        select({ type: 'route', id: props['routeId'] });
      }
    };
    let hoveredCommune: string | number | null = null;
    const clearHover = () => {
      if (hoveredCommune !== null && map.getSource(SOURCE.communes))
        map.setFeatureState({ source: SOURCE.communes, id: hoveredCommune }, { hover: false });
      hoveredCommune = null;
    };
    const onMove = (event: MapMouseEvent) => {
      const feature = hitAt(event);
      map.getCanvas().style.cursor = feature ? 'pointer' : '';
      const next =
        feature?.layer.id === LAYER.communesFill ||
        feature?.layer.id === LAYER.communesLine ||
        feature?.layer.id === LAYER.communesLabel
          ? (feature.id ?? null)
          : null;
      if (next === hoveredCommune) return;
      clearHover();
      hoveredCommune = next;
      if (next !== null)
        map.setFeatureState({ source: SOURCE.communes, id: next }, { hover: true });
    };
    const onLeave = () => {
      clearHover();
      map.getCanvas().style.cursor = '';
    };
    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.getCanvas().addEventListener('mouseleave', onLeave);
    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.getCanvas().removeEventListener('mouseleave', onLeave);
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
    const now = performance.now();

    for (const vehicle of vehicles) {
      // Un equipo puede reportar SIN fijacion satelital: manda (0,0), que cae
      // en el Golfo de Guinea. Dibujarlo pondria camiones chilenos en mitad
      // del Atlantico, asi que se omite del mapa. El vehiculo sigue en los
      // listados con su estado de conexion, que es donde eso si se explica.
      if (!vehicle.position || !vehicle.position.valid || !isUsableCoordinate(vehicle.position)) continue;
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
          sample: vehicle.position,
          path: null,
          animateUntil: now + Math.min(30_000, Math.max(0, 30_000 - (Date.now() - Date.parse(vehicle.position.timestamp)))),
          current: { ...target },
          target,
          segmentStart: { ...target },
          segmentStartedAt: now,
          segmentDurationMs: 0,
          status: vehicle.status,
          moving,
          plate: vehicle.plate,
          fleetCode: vehicle.fleetCode,
        });
      } else if (existing.sample.lat !== target.lat || existing.sample.lng !== target.lng) {
        // Posicion realmente nueva: el intervalo desde el ultimo cambio de
        // target es la mejor estimacion de cuanto tardara el proximo reporte.
        const path = roadPathForTransition(existing.sample, vehicle.position);
        existing.path = path;
        existing.sample = vehicle.position;
        existing.animateUntil = now + Math.min(30_000, Math.max(0, 30_000 - (Date.now() - Date.parse(vehicle.position.timestamp))));
        const observedInterval = now - existing.segmentStartedAt;
        existing.segmentStart = { ...existing.current };
        existing.segmentDurationMs = Math.min(
          MAX_SEGMENT_MS,
          Math.max(MIN_SEGMENT_MS, observedInterval || DEFAULT_SEGMENT_MS),
        );
        if (!path) existing.segmentDurationMs = 0;
        existing.segmentStartedAt = now;
        existing.target = path ? pointOnRoad(path, 1) : target;
        existing.status = vehicle.status;
        existing.moving = moving;
        existing.plate = vehicle.plate;
        existing.fleetCode = vehicle.fleetCode;
      } else {
        existing.sample = vehicle.position;
        existing.animateUntil = now + Math.min(30_000, Math.max(0, 30_000 - (Date.now() - Date.parse(vehicle.position.timestamp))));
        // Mismo punto que ya se tenia (ej. republicacion sin cambios): solo
        // refresca metadatos, sin reiniciar el tramo de animacion en curso.
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

    let followedCenter: { lat: number; lng: number } | null = null;

    const stop = startMapAnimationLoop((now) => {
      const animated = animatedRef.current;
      const features: VehicleFeatureInput[] = [];
      let needsFrame = false;

      for (const [vehicleId, state] of animated) {
        // Progreso en el tiempo, no en la distancia: el vehiculo se desliza
        // durante todo el intervalo real entre reportes (ver `segmentDurationMs`
        // mas arriba) en vez de llegar en menos de un segundo y quedarse quieto
        // esperando el proximo dato.
        const elapsed = now - state.segmentStartedAt;
        const t = state.segmentDurationMs > 0 ? Math.min(1, elapsed / state.segmentDurationMs) : 1;

        if (t < 1 && state.path) {
          state.current = pointOnRoad(state.path, easeInOutQuad(t));
          needsFrame = true;
        } else {
          state.current = { ...state.target };
        }
        const animateTruck = state.moving && now < state.animateUntil;
        if (animateTruck) needsFrame = true;

        features.push({
          vehicleId,
          plate: state.plate,
          fleetCode: state.fleetCode,
          lat: state.current.lat,
          lng: state.current.lng,
          heading: state.current.heading,
          status: state.status,
          moving: state.moving,
          animationFrame: animateTruck ? Math.floor(now / 180) % 4 : 0,
          selected: vehicleId === selectedVehicleId,
        });
      }

      updateVehicles(map, features);

      // Camara adherida al vehiculo seguido.
      if (following) {
        const state = animatedRef.current.get(following);
        if (state && (!followedCenter || followedCenter.lat !== state.current.lat || followedCenter.lng !== state.current.lng)) {
          followedCenter = { lat: state.current.lat, lng: state.current.lng };
          map.easeTo({
            center: [state.current.lng, state.current.lat],
            duration: 220,
            essential: true,
          });

          const trail = trailRef.current;
          const last = trail[trail.length - 1];
          if (
            !last ||
            Math.hypot(last.lat - state.current.lat, last.lng - state.current.lng) > 0.00008
          ) {
            trail.push({ lat: state.current.lat, lng: state.current.lng });
            if (trail.length > 300) trail.shift();
            updateFollowTrail(map, trail);
          }
        }
      }

      return needsFrame;
    });
    stopAnimationRef.current = stop;
    return () => {
      stop();
      if (stopAnimationRef.current === stop) stopAnimationRef.current = null;
    };
  }, [ready, following, selectedVehicleId, vehicles]);

  // Limpiar la estela al dejar de seguir.
  useEffect(() => {
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
    updateGeofences(map, geofences, selectedGeofenceId);
  }, [ready, geofences, selectedGeofenceId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateAlerts(map, alerts, selectedAlertId);
  }, [ready, alerts, selectedAlertId]);

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
    communes
      .filter((c) => c.boundary.length >= 3)
      .forEach((c) =>
        map.setFeatureState(
          { source: SOURCE.communes, id: c.code },
          { selected: c.code === inspectedCommuneCode },
        ),
      );
  }, [ready, communes, inspectedCommuneCode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    updateHeatmap(map, heatmapPoints);
  }, [ready, heatmapPoints]);

  /**
   * Refresco del trafico.
   *
   * MapLibre solo vuelve a pedir un tile ya cargado si cambia la URL de la
   * fuente: por eso el trafico se veria fijo en lo que había al encenderlo,
   * aunque cambiara en la realidad. Se agrega un parametro que cambia cada
   * minuto (mismo periodo que el `Cache-Control` del proxy) para forzar la
   * recarga de los tiles visibles.
   */
  useEffect(() => {
    if (!ready || !trafficEnabled) return;
    const map = mapRef.current;
    if (!map) return;

    const refresh = (): void => {
      const source = map.getSource(SOURCE.traffic) as RasterTileSource | undefined;
      source?.setTiles([`/api/trafico/tile/{z}/{x}/{y}?t=${Date.now()}`]);
    };

    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [ready, trafficEnabled]);

  // --- Visibilidad de capas ------------------------------------------------
  const effectiveLayers = useMemo(() => ({ ...layers, ...layerOverride }), [layers, layerOverride]);

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
    setLayerVisibility(
      map,
      [LAYER.geofenceFill, LAYER.geofenceLine, LAYER.geofenceLabel],
      effectiveLayers.geocercas,
    );
    setLayerVisibility(map, [LAYER.heatmap], effectiveLayers.calor);
    setLayerVisibility(map, [LAYER.traffic], trafficEnabled);
    setLayerVisibility(map, [LAYER.workOrders], effectiveLayers.pedidos);
    setLayerVisibility(map, [LAYER.alerts], effectiveLayers.alertas);
    setLayerVisibility(
      map,
      [LAYER.communesFill, LAYER.communesLine, LAYER.communesLabel],
      effectiveLayers.comunas,
    );
  }, [ready, effectiveLayers, trafficEnabled]);

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
      // Un (0,0) arrastraria el encuadre hasta el Atlantico y dejaria la flota
      // real como un punto invisible.
      if (vehicle.position && isUsableCoordinate(vehicle.position)) {
        puntos.push([vehicle.position.lng, vehicle.position.lat]);
      }
    }
    for (const route of routes) {
      for (const p of [...route.plannedPath, ...route.executedPath, ...route.stops]) {
        if (isUsableCoordinate(p)) puntos.push([p.lng, p.lat]);
      }
    }
    for (const point of [...clients, ...workOrders, ...alerts]) {
      if (isUsableCoordinate(point)) puntos.push([point.lng, point.lat]);
    }
    for (const geofence of geofences) {
      for (const p of geofencePoints(geofence)) {
        if (isUsableCoordinate(p)) puntos.push([p.lng, p.lat]);
      }
    }
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
  }, [ready, autoFit, vehicles, routes, clients, workOrders, alerts, geofences]);

  /**
   * Cambio de agrupamiento.
   *
   * En MapLibre `cluster` es una opcion de la FUENTE, no de la capa: no se
   * puede alternar. Hay que destruir fuente y capas y volver a crearlas, y
   * despues reponer los datos, porque la fuente nueva nace vacia.
   *
   * Se salta el primer render: la fuente inicial ya se creo agrupada.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || clusterAplicado.current === clusterClients) return;

    clusterAplicado.current = clusterClients;
    try {
      removeClientLayers(map);
      registerClientLayers(map, clusterClients);
      updateClients(map, clients, selection?.type === 'client' ? selection.id : null);
      const clientLayers = [
        LAYER.clientClusters,
        LAYER.clientClusterCount,
        LAYER.clientPoints,
        LAYER.clientLabels,
      ];
      setLayerVisibility(map, clientLayers, effectiveLayers.clientes);
      // Recreated client layers must stay below orders and vehicles.
      for (const id of clientLayers) map.moveLayer(id, LAYER.workOrders);
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : String(error));
    }
  }, [ready, clusterClients, clients, selection, effectiveLayers.clientes]);

  // --- Encuadre solicitado -------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !focus) return;

    if (focus.bounds) {
      const padding = Math.min(
        64,
        map.getContainer().clientWidth / 5,
        map.getContainer().clientHeight / 5,
      );
      map.fitBounds(boundsToLngLatBounds(focus.bounds), { padding, maxZoom: 16, duration: 700 });
      return;
    }
    map.flyTo({
      center: [focus.center.lng, focus.center.lat],
      zoom: focus.zoom ?? 15,
      duration: 900,
      essential: true,
    });
  }, [ready, focus]);

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
