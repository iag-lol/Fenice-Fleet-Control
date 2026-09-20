import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl';

import { circleToPolygon, isUsableCoordinate } from '@/lib/geo';
import { closedRing } from '@/lib/map-navigation';
import type { Geofence, HeatmapPoint, LatLng } from '@/types/core';
import type {
  AlertMapPoint,
  ClientMapPoint,
  RouteGeometry,
  WorkOrderMapPoint,
} from '@/types/views';

/**
 * Definicion y actualizacion de las capas del mapa operacional.
 *
 * Separado del componente React a proposito: aqui vive el conocimiento de
 * MapLibre (fuentes, capas, expresiones de estilo) y alli la orquestacion de
 * estado. Ninguna formula geometrica ni regla de negocio se calcula en este
 * archivo; llegan resueltas desde los motores.
 */

export const SOURCE = {
  vehicles: 'src-vehicles',
  clients: 'src-clients',
  heatmap: 'src-heatmap',
  routesPlanned: 'src-routes-planned',
  routesExecuted: 'src-routes-executed',
  routeStops: 'src-route-stops',
  geofences: 'src-geofences',
  traffic: 'src-traffic',
  alerts: 'src-alerts',
  workOrders: 'src-work-orders',
  communes: 'src-communes',
  followTrail: 'src-follow-trail',
  trajectoryEvents: 'src-trajectory-events',
} as const;

export const LAYER = {
  communesFill: 'lyr-communes-fill',
  communesLine: 'lyr-communes-line',
  communesLabel: 'lyr-communes-label',
  heatmap: 'lyr-heatmap',
  geofenceFill: 'lyr-geofence-fill',
  geofenceLine: 'lyr-geofence-line',
  geofenceLabel: 'lyr-geofence-label',
  traffic: 'lyr-traffic',
  routePlanned: 'lyr-route-planned',
  routeExecuted: 'lyr-route-executed',
  routeStops: 'lyr-route-stops',
  routeStopLabels: 'lyr-route-stop-labels',
  clientClusters: 'lyr-client-clusters',
  clientClusterCount: 'lyr-client-cluster-count',
  clientPoints: 'lyr-client-points',
  clientLabels: 'lyr-client-labels',
  workOrders: 'lyr-work-orders',
  alerts: 'lyr-alerts',
  vehiclePulse: 'lyr-vehicle-pulse',
  vehicles: 'lyr-vehicles',
  vehicleLabels: 'lyr-vehicle-labels',
  followTrail: 'lyr-follow-trail',
  trajectoryEvents: 'lyr-trajectory-events',
  trajectoryEventLabels: 'lyr-trajectory-event-labels',
} as const;

/**
 * Fuentes de las etiquetas.
 *
 * Se declaran como una sola familia por capa, nunca como pila compuesta: el
 * servidor de glifos responde 404 (con HTML) a las pilas, y ese HTML hace
 * fallar el parseo del tile completo.
 */
const REGULAR_FONT = 'Noto Sans Regular';
const BOLD_FONT = 'Noto Sans Bold';

type FeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

function setData(map: MapLibreMap, sourceId: string, data: FeatureCollection): void {
  const source = map.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

// ---------------------------------------------------------------------------
// Registro de fuentes y capas
// ---------------------------------------------------------------------------

/**
 * Crea todas las fuentes y capas. Se invoca tras `load` y tras cada cambio de
 * estilo del basemap, momento en que MapLibre descarta las capas propias.
 *
 * El orden de insercion define el apilado visual: territorio y calor al fondo,
 * geometria de rutas encima, luego puntos, y los vehiculos siempre arriba
 * porque son el objeto que el operador sigue.
 */
export function registerLayers(map: MapLibreMap): void {
  // --- Comunas -------------------------------------------------------------
  map.addSource(SOURCE.communes, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.communesFill,
    type: 'fill',
    source: SOURCE.communes,
    layout: { visibility: 'none' },
    paint: {
      // Seleccionada, bajo el cursor y en reposo: tres niveles distinguibles
      // sin que el relleno tape la operacion que hay encima.
      'fill-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#0d90ae',
        ['boolean', ['feature-state', 'hover'], false],
        '#22aecb',
        '#64748b',
      ],
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        0.2,
        ['boolean', ['feature-state', 'hover'], false],
        0.12,
        0.03,
      ],
    },
  });
  map.addLayer({
    id: LAYER.communesLine,
    type: 'line',
    source: SOURCE.communes,
    layout: { visibility: 'none' },
    paint: {
      // El limite debe leerse sobre un basemap deliberadamente palido: con un
      // gris claro y menos de un pixel de grosor era invisible.
      'line-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        '#0b5c75',
        '#5b6a7e',
      ],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['case', ['boolean', ['feature-state', 'selected'], false], 2.5, 1.2],
        14,
        ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2.2],
      ],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: LAYER.communesLabel,
    type: 'symbol',
    source: SOURCE.communes,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': [REGULAR_FONT],
      // El tamano crece con el zoom y las etiquetas se descartan entre si:
      // 52 nombres superpuestos serian ilegibles en la vista general.
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 11, 15, 13],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.08,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 6,
      'text-max-width': 8,
      // Prioriza las comunas con mas operacion cuando compiten por el espacio.
      'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'clients'], 0]],
    },
    paint: {
      'text-color': '#334155',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2,
    },
  });

  // --- Mapa de calor -------------------------------------------------------
  map.addSource(SOURCE.heatmap, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.heatmap,
    type: 'heatmap',
    source: SOURCE.heatmap,
    layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 5, 1],
      // A mayor zoom, mas intensidad: compensa la dispersion de los puntos.
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 15, 2.4],
      'heatmap-color': [
        'interpolate',
        ['linear'],
        ['heatmap-density'],
        0,
        'rgba(59, 130, 246, 0)',
        0.2,
        'rgba(59, 130, 246, 0.45)',
        0.4,
        'rgba(14, 165, 233, 0.6)',
        0.6,
        'rgba(234, 179, 8, 0.7)',
        0.8,
        'rgba(234, 88, 12, 0.8)',
        1,
        'rgba(190, 18, 60, 0.88)',
      ],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 12, 26, 16, 46],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.85, 17, 0.55],
    },
  });

  // --- Geocercas -----------------------------------------------------------
  map.addSource(SOURCE.geofences, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.geofenceFill,
    type: 'fill',
    source: SOURCE.geofences,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': ['case', ['get', 'active'], ['get', 'color'], '#64748b'],
      'fill-opacity': ['case', ['get', 'selected'], 0.24, ['get', 'active'], 0.1, 0.035],
    },
  });
  map.addLayer({
    id: LAYER.geofenceLine,
    type: 'line',
    source: SOURCE.geofences,
    layout: { visibility: 'none' },
    paint: {
      'line-color': ['case', ['get', 'active'], ['get', 'color'], '#64748b'],
      'line-width': ['case', ['get', 'selected'], 3.5, 1.8],
      'line-opacity': ['case', ['get', 'selected'], 1, ['get', 'active'], 0.85, 0.5],
      'line-dasharray': [2, 2],
    },
  });
  map.addLayer({
    id: LAYER.geofenceLabel,
    type: 'symbol',
    source: SOURCE.geofences,
    layout: {
      visibility: 'none',
      'text-field': ['get', 'name'],
      'text-font': [REGULAR_FONT],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12, 17, 14],
      'text-allow-overlap': false,
      'text-padding': 4,
      'text-max-width': 10,
    },
    paint: {
      'text-color': ['case', ['get', 'active'], ['get', 'color'], '#64748b'],
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.6,
    },
  });

  // --- Trafico en tiempo real ------------------------------------------------
  // Tiles rasterizados (como los del mapa base), no lineas por muestreo.
  // TomTom tambien ofrece `flowSegmentData`, que solo devuelve el tramo mas
  // cercano a UN punto: sirve para el ETA de una ruta concreta, no para
  // cubrir una ciudad entera, y con pocos puntos de muestreo se veia como un
  // puñado de lineas sueltas en medio del mapa. El servicio de tiles cubre
  // todas las vias visibles, igual que el trafico de Google Maps.
  // La clave nunca llega al navegador: se pide via el proxy propio
  // /api/trafico/tile/{z}/{x}/{y}, que la agrega en el servidor.
  map.addSource(SOURCE.traffic, {
    type: 'raster',
    tiles: ['/api/trafico/tile/{z}/{x}/{y}'],
    tileSize: 256,
  });
  map.addLayer({
    id: LAYER.traffic,
    type: 'raster',
    source: SOURCE.traffic,
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.8 },
  });

  // --- Rutas ---------------------------------------------------------------
  map.addSource(SOURCE.routesPlanned, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.routePlanned,
    type: 'line',
    source: SOURCE.routesPlanned,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      // La ruta resaltada se distingue por color y grosor, no solo por opacidad.
      'line-color': ['case', ['get', 'highlighted'], '#0d90ae', '#94a3b8'],
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        1.5,
        14,
        ['case', ['get', 'highlighted'], 4, 2.5],
      ],
      'line-opacity': ['case', ['get', 'highlighted'], 0.95, 0.65],
      'line-dasharray': [3, 2],
    },
  });

  map.addSource(SOURCE.routesExecuted, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.routeExecuted,
    type: 'line',
    source: SOURCE.routesExecuted,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0e7490',
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 14, 3.4],
      'line-opacity': ['case', ['get', 'highlighted'], 0.95, 0.7],
    },
  });

  map.addSource(SOURCE.routeStops, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.routeStops,
    type: 'circle',
    source: SOURCE.routeStops,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10],
      'circle-color': [
        'match',
        ['get', 'state'],
        'visitado',
        '#15803d',
        'proximo',
        '#b45309',
        '#94a3b8',
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
  map.addLayer({
    id: LAYER.routeStopLabels,
    type: 'symbol',
    source: SOURCE.routeStops,
    layout: {
      'text-field': ['to-string', ['get', 'sequence']],
      'text-size': 10,
      'text-allow-overlap': true,
      'text-font': [BOLD_FONT],
    },
    paint: { 'text-color': '#ffffff' },
  });

  registerClientLayers(map, true);

  // --- Ordenes de trabajo pendientes ---------------------------------------
  map.addSource(SOURCE.workOrders, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.workOrders,
    type: 'symbol',
    source: SOURCE.workOrders,
    layout: {
      visibility: 'none',
      'icon-image': ['case', ['get', 'urgent'], 'work-order-pin-urgent', 'work-order-pin'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1],
      'icon-allow-overlap': true,
    },
  });

  // --- Alertas -------------------------------------------------------------
  map.addSource(SOURCE.alerts, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.alerts,
    type: 'circle',
    source: SOURCE.alerts,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': [
        '+',
        ['interpolate', ['linear'], ['zoom'], 10, 7, 15, 12],
        ['case', ['get', 'selected'], 3, 0],
      ],
      'circle-color': [
        'match',
        ['get', 'severity'],
        'critical',
        'rgba(220, 38, 38, 0.22)',
        'warning',
        'rgba(180, 83, 9, 0.22)',
        'rgba(13, 144, 174, 0.2)',
      ],
      'circle-stroke-width': ['case', ['get', 'selected'], 4, 2.5],
      'circle-stroke-color': [
        'match',
        ['get', 'severity'],
        'critical',
        '#dc2626',
        'warning',
        '#b45309',
        '#0d90ae',
      ],
    },
  });

  // --- Estela del vehiculo seguido -----------------------------------------
  map.addSource(SOURCE.followTrail, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.followTrail,
    type: 'line',
    source: SOURCE.followTrail,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0e7490', 'line-width': 3.5, 'line-opacity': 0.8 },
  });

  // --- Eventos del trayecto del dia (vehiculo seleccionado) ----------------
  //
  // Detenciones, exceso de velocidad y encendido/apagado, todos en una sola
  // capa clasificada por color: son la respuesta a "que paso realmente en
  // esta ruta", y solo tienen sentido junto a la linea del trayecto que
  // dibuja `updateRoutes`.
  map.addSource(SOURCE.trajectoryEvents, { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: LAYER.trajectoryEvents,
    type: 'circle',
    source: SOURCE.trajectoryEvents,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 10],
      'circle-color': [
        'match',
        ['get', 'eventType'],
        'speeding',
        '#dc2626',
        'stop',
        '#b45309',
        'ignition_on',
        '#15803d',
        '#475569',
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });
  map.addLayer({
    id: LAYER.trajectoryEventLabels,
    type: 'symbol',
    source: SOURCE.trajectoryEvents,
    layout: {
      // Un caracter por tipo, igual que la secuencia de paradas de ruta:
      // no hace falta arte nuevo para que se distingan de un vistazo.
      'text-field': [
        'match',
        ['get', 'eventType'],
        'speeding',
        'V',
        'stop',
        'P',
        'ignition_on',
        'E',
        'A',
      ],
      'text-size': 10,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-font': [BOLD_FONT],
    },
    paint: { 'text-color': '#ffffff' },
  });

  // --- Vehiculos (siempre en el nivel superior) ----------------------------
  map.addSource(SOURCE.vehicles, { type: 'geojson', data: EMPTY });

  map.addLayer({
    id: LAYER.vehiclePulse,
    type: 'circle',
    source: SOURCE.vehicles,
    // Pulsan los que estan en movimiento y los que arrastran un problema: el
    // latido marca "esto esta pasando ahora".
    filter: ['in', ['get', 'status'], ['literal', ['moving', 'warning', 'deviated']]],
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 12, 15, 20],
      'circle-color': [
        'match',
        ['get', 'status'],
        'warning',
        'rgba(220, 38, 38, 0.14)',
        'deviated',
        'rgba(194, 65, 12, 0.14)',
        'rgba(21, 128, 61, 0.12)',
      ],
      'circle-stroke-width': 1,
      'circle-stroke-color': [
        'match',
        ['get', 'status'],
        'warning',
        'rgba(220, 38, 38, 0.35)',
        'deviated',
        'rgba(194, 65, 12, 0.35)',
        'rgba(21, 128, 61, 0.28)',
      ],
    },
  });

  map.addLayer({
    id: LAYER.vehicles,
    type: 'symbol',
    source: SOURCE.vehicles,
    layout: {
      'icon-image': [
        'case',
        ['get', 'moving'],
        ['concat', 'vehicle-arrow-', ['get', 'status'], '-', ['to-string', ['coalesce', ['get', 'animationFrame'], 0]]],
        ['concat', 'vehicle-dot-', ['get', 'status']],
      ],
      // El icono se redibujo mas grande y detallado (56px de origen, antes
      // 44px) sin bajar estos multiplicadores a la par: se veia enorme y
      // poco profesional a nivel de calle. Se acotan para que el camion siga
      // siendo un marcador discreto, no un dibujo que tapa el mapa.
      'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 14, 0.55, 17, 0.7],
      // Siempre se orienta segun el ultimo rumbo real reportado por el GPS,
      // en movimiento o detenido: un camion detenido apuntando al norte sin
      // relacion con hacia donde miraba realmente confunde mas de lo que
      // aclara. El rumbo llega ya suavizado desde la animacion del marcador.
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  map.addLayer({
    id: LAYER.vehicleLabels,
    type: 'symbol',
    source: SOURCE.vehicles,
    layout: {
      'text-field': ['get', 'plate'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 13, 12],
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-font': [BOLD_FONT],
      // La patente identifica al vehiculo: se muestra siempre, sin descartarse
      // por solapamiento, porque saber que camion es resulta mas util que
      // evitar que dos etiquetas se toquen.
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#0f1c2e',
      'text-halo-color': '#ffffff',
      'text-halo-width': 2.4,
      'text-halo-blur': 0.2,
    },
  });
}

// ---------------------------------------------------------------------------
// Actualizacion de datos
// ---------------------------------------------------------------------------

export interface VehicleFeatureInput {
  animationFrame?: number;
  vehicleId: string;
  plate: string;
  fleetCode: string;
  lat: number;
  lng: number;
  heading: number;
  status: string;
  moving: boolean;
  selected: boolean;
}

export function updateVehicles(map: MapLibreMap, vehicles: VehicleFeatureInput[]): void {
  setData(map, SOURCE.vehicles, {
    type: 'FeatureCollection',
    features: vehicles.filter(isUsableCoordinate).map((v) => ({
      type: 'Feature',
      id: v.vehicleId,
      geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      properties: {
        vehicleId: v.vehicleId,
        plate: v.plate,
        fleetCode: v.fleetCode,
        heading: Number.isFinite(v.heading) ? v.heading : 0,
        status: v.status,
        moving: v.moving,
        animationFrame: v.animationFrame ?? 0,
        selected: v.selected,
      },
    })),
  });
}

export function updateClients(
  map: MapLibreMap,
  clients: ClientMapPoint[],
  selectedId: string | null,
): void {
  setData(map, SOURCE.clients, {
    type: 'FeatureCollection',
    // Sin `id` de entidad: el indice de agrupamiento de MapLibre exige
    // identificadores numericos y descarta en silencio las entidades cuyo id
    // es una cadena, dejando la capa vacia. El identificador del cliente
    // viaja en las propiedades, que es de donde lo leen las interacciones.
    features: clients.filter(isUsableCoordinate).map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      properties: {
        clientId: c.clientId,
        code: c.code,
        name: c.name,
        status: c.status,
        communeName: c.communeName,
        selected: c.clientId === selectedId,
      },
    })),
  });
}

export function updateHeatmap(map: MapLibreMap, points: HeatmapPoint[]): void {
  setData(map, SOURCE.heatmap, {
    type: 'FeatureCollection',
    features: points
      .filter((p) => isUsableCoordinate(p) && Number.isFinite(p.weight))
      .map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        properties: { weight: p.weight },
      })),
  });
}

export function updateRoutes(
  map: MapLibreMap,
  routes: RouteGeometry[],
  highlightedRouteId: string | null,
): void {
  const planned: FeatureCollection = {
    type: 'FeatureCollection',
    features: routes
      .map((r) => ({ route: r, points: r.plannedPath.filter(isUsableCoordinate) }))
      .filter(({ points }) => points.length >= 2)
      .map(({ route: r, points }) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
        properties: {
          routeId: r.routeId,
          code: r.code,
          highlighted: highlightedRouteId === r.routeId,
        },
      })),
  };

  const executed: FeatureCollection = {
    type: 'FeatureCollection',
    features: routes
      .flatMap((r) => (r.executedSegments ?? [r.executedPath]).map((segment) => ({ route: r, points: segment.filter(isUsableCoordinate) })))
      .filter(({ points }) => points.length >= 2)
      .map(({ route: r, points }) => ({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: points.map((p) => [p.lng, p.lat]),
        },
        properties: {
          routeId: r.routeId,
          highlighted: highlightedRouteId === r.routeId,
        },
      })),
  };

  const stops: FeatureCollection = {
    type: 'FeatureCollection',
    features: routes.flatMap((route) =>
      route.stops.filter(isUsableCoordinate).map((stop) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [stop.lng, stop.lat] },
        properties: {
          routeId: route.routeId,
          workOrderId: stop.workOrderId,
          sequence: stop.sequence,
          clientName: stop.clientName,
          state:
            stop.status === 'visita_detectada' || stop.status === 'completada'
              ? 'visitado'
              : stop.status === 'proxima' || stop.status === 'en_cliente'
                ? 'proximo'
                : 'pendiente',
        },
      })),
    ),
  };

  setData(map, SOURCE.routesPlanned, planned);
  setData(map, SOURCE.routesExecuted, executed);
  setData(map, SOURCE.routeStops, stops);
}

export interface TrajectoryEventInput {
  id: string;
  eventType: 'stop' | 'speeding' | 'ignition_on' | 'ignition_off';
  lat: number;
  lng: number;
}

export function updateTrajectoryEvents(map: MapLibreMap, events: TrajectoryEventInput[]): void {
  setData(map, SOURCE.trajectoryEvents, {
    type: 'FeatureCollection',
    features: events.filter(isUsableCoordinate).map((event) => ({
      type: 'Feature',
      id: event.id,
      geometry: { type: 'Point', coordinates: [event.lng, event.lat] },
      properties: { trajectoryEventId: event.id, eventType: event.eventType },
    })),
  });
}

export function updateGeofences(
  map: MapLibreMap,
  geofences: Geofence[],
  selectedId: string | null = null,
): void {
  setData(map, SOURCE.geofences, {
    type: 'FeatureCollection',
    features: geofences
      .map((geofence) => {
        // Los circulos se aproximan a poligono: MapLibre no tiene primitiva de
        // circulo geografico y `circle-radius` esta en pixeles, no en metros.
        const vertices: LatLng[] =
          geofence.geometry.shape === 'circle'
            ? isUsableCoordinate(geofence.geometry.center) &&
              Number.isFinite(geofence.geometry.radiusMeters) &&
              geofence.geometry.radiusMeters > 0
              ? circleToPolygon(geofence.geometry.center, geofence.geometry.radiusMeters)
              : []
            : geofence.geometry.vertices;

        const ring = closedRing(vertices);
        if (ring.length < 4) return null;

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring],
          },
          properties: {
            geofenceId: geofence.id,
            name: geofence.name,
            kind: geofence.kind,
            color: geofence.color,
            active: geofence.active,
            selected: geofence.id === selectedId,
          },
        };
      })
      .filter((feature): feature is NonNullable<typeof feature> => feature !== null),
  });
}

export function updateWorkOrders(map: MapLibreMap, workOrders: WorkOrderMapPoint[]): void {
  setData(map, SOURCE.workOrders, {
    type: 'FeatureCollection',
    features: workOrders.filter(isUsableCoordinate).map((w) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [w.lng, w.lat] },
      properties: {
        workOrderId: w.workOrderId,
        number: w.number,
        clientName: w.clientName,
        urgent: w.priority === 'urgente' || w.priority === 'alta',
      },
    })),
  });
}

export function updateAlerts(
  map: MapLibreMap,
  alerts: AlertMapPoint[],
  selectedId: string | null = null,
): void {
  setData(map, SOURCE.alerts, {
    type: 'FeatureCollection',
    features: alerts.filter(isUsableCoordinate).map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      properties: {
        alertId: a.alertId,
        severity: a.severity,
        title: a.title,
        selected: a.alertId === selectedId,
      },
    })),
  });
}

export interface CommuneFeatureInput {
  code: string;
  name: string;
  center: LatLng;
  boundary: LatLng[];
  /** Numero de clientes, usado para priorizar que etiquetas se muestran. */
  clients?: number;
}

export function updateCommunes(map: MapLibreMap, communes: CommuneFeatureInput[]): void {
  setData(map, SOURCE.communes, {
    type: 'FeatureCollection',
    features: communes
      .map((c) => ({ commune: c, ring: closedRing(c.boundary) }))
      .filter(({ ring }) => ring.length >= 4)
      .map(({ commune: c, ring }) => ({
        type: 'Feature',
        // La clave territorial permanece estable aunque cambie el orden del
        // servidor: el hover y la seleccion no saltan a otra comuna.
        id: c.code,
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
        properties: { code: c.code, name: c.name, clients: c.clients ?? 0 },
      })),
  });
}

export function updateFollowTrail(map: MapLibreMap, path: LatLng[]): void {
  setData(map, SOURCE.followTrail, {
    type: 'FeatureCollection',
    features:
      path.length >= 2
        ? [
            {
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: path.map((p) => [p.lng, p.lat]) },
              properties: {},
            },
          ]
        : [],
  });
}

/** Aplica visibilidad a un conjunto de capas. */
export function setLayerVisibility(map: MapLibreMap, layerIds: string[], visible: boolean): void {
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    }
  }
}

export function boundsToLngLatBounds(bounds: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}): LngLatBoundsLike {
  return [
    [bounds.minLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
  ];
}

/**
 * Capas de clientes.
 *
 * Van en su propia funcion porque el AGRUPAMIENTO es una opcion de la FUENTE
 * en MapLibre, no de la capa: no se puede encender ni apagar sobre la marcha.
 * Para cambiarlo hay que destruir la fuente y volver a crearla, y con ella
 * sus capas. Aislarlo aqui evita repetir esa secuencia en dos sitios.
 */
export function registerClientLayers(map: MapLibreMap, cluster: boolean): void {
  map.addSource(SOURCE.clients, {
    type: 'geojson',
    data: EMPTY,
    cluster,
    // Sin agrupamiento, cientos de pines saturan la lectura del mapa. El
    // corte se fija bajo para que los pines individuales aparezcan en cuanto
    // el operador se acerca a un sector concreto.
    clusterMaxZoom: 12,
    clusterRadius: 42,
    clusterProperties: {
      dormidos: ['+', ['case', ['==', ['get', 'status'], 'dormant'], 1, 0]],
      observacion: ['+', ['case', ['==', ['get', 'status'], 'warning'], 1, 0]],
    },
  });

  map.addLayer({
    id: LAYER.clientClusters,
    type: 'circle',
    source: SOURCE.clients,
    filter: ['has', 'point_count'],
    paint: {
      // El color del grupo refleja su composicion: si predominan dormidos, se
      // ve rojo aunque este agrupado. Un grupo gris ocultaria el problema.
      'circle-color': [
        'case',
        ['>', ['/', ['get', 'dormidos'], ['get', 'point_count']], 0.4],
        'rgba(220, 38, 38, 0.92)',
        ['>', ['/', ['get', 'observacion'], ['get', 'point_count']], 0.4],
        'rgba(180, 83, 9, 0.92)',
        'rgba(13, 144, 174, 0.92)',
      ],
      'circle-radius': ['step', ['get', 'point_count'], 15, 10, 19, 30, 24, 80, 30],
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ffffff',
    },
  });

  map.addLayer({
    id: LAYER.clientClusterCount,
    type: 'symbol',
    source: SOURCE.clients,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-size': 12,
      'text-font': [BOLD_FONT],
    },
    paint: { 'text-color': '#ffffff' },
  });

  map.addLayer({
    id: LAYER.clientPoints,
    type: 'symbol',
    source: SOURCE.clients,
    filter: ['!', ['has', 'point_count']],
    layout: {
      // Pin de gota anclado por la punta: marca el domicilio exacto y se
      // distingue del disco del vehiculo y del circulo numerado de parada.
      'icon-image': [
        'concat',
        'client-pin-',
        ['match', ['get', 'status'], 'active', 'active', 'warning', 'warning', 'dormant'],
        ['case', ['get', 'selected'], '-selected', ''],
      ],
      'icon-anchor': 'bottom',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 13, 0.8, 16, 1],
      // Los pines no se descartan entre si: ocultar clientes seria ocultar
      // informacion comercial, no reducir ruido.
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });

  map.addLayer({
    id: LAYER.clientLabels,
    type: 'symbol',
    source: SOURCE.clients,
    filter: ['!', ['has', 'point_count']],
    // El nombre solo aparece cuando hay espacio real para leerlo.
    minzoom: 14.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': [REGULAR_FONT],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.4],
      'text-max-width': 9,
      'text-optional': true,
    },
    paint: {
      'text-color': '#334155',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.8,
    },
  });
}

/** Retira fuente y capas de clientes para poder recrearlas. */
export function removeClientLayers(map: MapLibreMap): void {
  for (const layer of [
    LAYER.clientLabels,
    LAYER.clientPoints,
    LAYER.clientClusterCount,
    LAYER.clientClusters,
  ]) {
    if (map.getLayer(layer)) map.removeLayer(layer);
  }
  if (map.getSource(SOURCE.clients)) map.removeSource(SOURCE.clients);
}
