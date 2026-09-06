'use client';

import type { GeoJSONSource, Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { useCallback, useEffect, useRef, useState } from 'react';

import { circleToPolygon, haversineMeters } from '@/lib/geo';
import type { GeofenceGeometry, LatLng } from '@/types/core';

/**
 * Dibujo de geocercas sobre el mapa.
 *
 * Dos modos, cada uno con el gesto que le corresponde:
 *
 *  - CIRCULAR: un clic fija el centro; el movimiento del cursor define el
 *    radio; el segundo clic lo confirma. Es el gesto natural para un radio de
 *    entrega, que es lo que mas se dibuja.
 *  - POLIGONAL: cada clic anade un vertice; doble clic o el boton cierran el
 *    poligono. Para recintos con forma propia (una faena, una playa de carga).
 *
 * La previsualizacion vive en su propia fuente para no interferir con las
 * geocercas ya guardadas.
 */

export type DrawingMode = 'none' | 'circle' | 'polygon';

const PREVIEW_SOURCE = 'src-geofence-draft';
const PREVIEW_FILL = 'lyr-geofence-draft-fill';
const PREVIEW_LINE = 'lyr-geofence-draft-line';
const PREVIEW_VERTICES = 'lyr-geofence-draft-vertices';

export interface GeofenceDrawingState {
  mode: DrawingMode;
  /** Geometria terminada, lista para guardar. */
  geometry: GeofenceGeometry | null;
  /** Radio en curso, en metros, mientras se dibuja un circulo. */
  draftRadius: number | null;
  /**
   * `true` cuando ya se fijo el centro y falta el radio.
   *
   * En un telefono no hay puntero que sobrevuele el mapa, asi que el radio no
   * se previsualiza al mover: entre el primer toque y el segundo no ocurria
   * NADA en pantalla y parecia que el dibujo no funcionaba. Este indicador
   * permite decirle al operador en que paso esta.
   */
  centerPlaced: boolean;
  /** Vertices colocados mientras se dibuja un poligono. */
  draftVertexCount: number;
  startCircle: () => void;
  startPolygon: () => void;
  closePolygon: () => void;
  undoVertex: () => void;
  cancel: () => void;
  /** Carga una geometria existente para editarla. */
  loadGeometry: (geometry: GeofenceGeometry) => void;
}

type EmptyCollection = GeoJSON.FeatureCollection<GeoJSON.Geometry, Record<string, unknown>>;

const EMPTY: EmptyCollection = { type: 'FeatureCollection', features: [] };

export function useGeofenceDrawing(map: MapLibreMap | null): GeofenceDrawingState {
  const [mode, setMode] = useState<DrawingMode>('none');
  const [geometry, setGeometry] = useState<GeofenceGeometry | null>(null);
  const [draftRadius, setDraftRadius] = useState<number | null>(null);
  const [centerPlaced, setCenterPlaced] = useState(false);
  const [draftVertexCount, setDraftVertexCount] = useState(0);

  const centerRef = useRef<LatLng | null>(null);
  const verticesRef = useRef<LatLng[]>([]);
  const modeRef = useRef<DrawingMode>('none');

  modeRef.current = mode;

  // --- Capas de previsualizacion -------------------------------------------
  useEffect(() => {
    if (!map) return;

    const register = (): void => {
      if (map.getSource(PREVIEW_SOURCE)) return;

      map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: PREVIEW_FILL,
        type: 'fill',
        source: PREVIEW_SOURCE,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#0d90ae', 'fill-opacity': 0.16 },
      });
      map.addLayer({
        id: PREVIEW_LINE,
        type: 'line',
        source: PREVIEW_SOURCE,
        filter: ['!=', ['geometry-type'], 'Point'],
        paint: { 'line-color': '#0b5c75', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
      });
      map.addLayer({
        id: PREVIEW_VERTICES,
        type: 'circle',
        source: PREVIEW_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#0b5c75',
        },
      });
    };

    // `map` solo llega aqui a traves de `onMapReady`, que `FleetMap` invoca
    // DESPUES de que su propio evento `load` ya disparo y registro sus capas
    // (ver fleet-map.tsx). Ese `load` es un evento de una sola vez: para
    // cuando este efecto corre, ya paso, y `map.once('load', ...)` nunca
    // volveria a llamarse — asi quedaba esta capa de previsualizacion sin
    // registrar nunca, y el dibujo no mostraba nada mientras el operador
    // hacia clic. Anadir fuentes y capas es seguro apenas el estilo del mapa
    // existe, que es garantizado por ese mismo contrato; no hace falta
    // esperar a que `isStyleLoaded()` se ponga en verdadero (fluctua mientras
    // OTRAS fuentes del mapa siguen cargando sus propios tiles).
    register();

    return () => {
      for (const layer of [PREVIEW_VERTICES, PREVIEW_LINE, PREVIEW_FILL]) {
        if (map.getLayer(layer)) map.removeLayer(layer);
      }
      if (map.getSource(PREVIEW_SOURCE)) map.removeSource(PREVIEW_SOURCE);
    };
  }, [map]);

  const paint = useCallback(
    (shape: GeofenceGeometry | null, extraVertices: LatLng[] = []) => {
      if (!map || !map.getSource(PREVIEW_SOURCE)) return;

      const features: GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>[] = [];

      if (shape) {
        const ring =
          shape.shape === 'circle'
            ? circleToPolygon(shape.center, shape.radiusMeters)
            : [...shape.vertices, shape.vertices[0]!];

        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring.map((p) => [p.lng, p.lat])] },
          properties: {},
        });
      }

      for (const vertex of extraVertices) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [vertex.lng, vertex.lat] },
          properties: {},
        });
      }

      const source = map.getSource(PREVIEW_SOURCE) as GeoJSONSource | undefined;
      source?.setData({ type: 'FeatureCollection', features });
    },
    [map],
  );

  // --- Gestos de dibujo -----------------------------------------------------
  useEffect(() => {
    if (!map || mode === 'none') return;

    const onClick = (event: MapMouseEvent): void => {
      const point: LatLng = { lat: event.lngLat.lat, lng: event.lngLat.lng };

      if (modeRef.current === 'circle') {
        if (centerRef.current === null) {
          centerRef.current = point;
          setCenterPlaced(true);
          paint(null, [point]);
          return;
        }

        const radius = Math.max(20, Math.round(haversineMeters(centerRef.current, point)));
        const shape: GeofenceGeometry = {
          shape: 'circle',
          center: centerRef.current,
          radiusMeters: radius,
        };

        setGeometry(shape);
        setDraftRadius(radius);
        paint(shape, [centerRef.current]);
        setMode('none');
        setCenterPlaced(false);
        centerRef.current = null;
        return;
      }

      verticesRef.current = [...verticesRef.current, point];
      setDraftVertexCount(verticesRef.current.length);

      const vertices = verticesRef.current;
      paint(
        vertices.length >= 3 ? { shape: 'polygon', vertices } : null,
        vertices,
      );
    };

    const onMouseMove = (event: MapMouseEvent): void => {
      if (modeRef.current !== 'circle' || centerRef.current === null) return;

      const radius = Math.max(
        20,
        Math.round(haversineMeters(centerRef.current, { lat: event.lngLat.lat, lng: event.lngLat.lng })),
      );
      setDraftRadius(radius);
      paint({ shape: 'circle', center: centerRef.current, radiusMeters: radius }, [
        centerRef.current,
      ]);
    };

    const onDoubleClick = (event: MapMouseEvent): void => {
      if (modeRef.current !== 'polygon') return;
      // Evita que el doble clic haga zoom mientras se cierra el poligono.
      event.preventDefault();
      if (verticesRef.current.length < 3) return;

      const shape: GeofenceGeometry = { shape: 'polygon', vertices: verticesRef.current };
      setGeometry(shape);
      paint(shape, verticesRef.current);
      setMode('none');
    };

    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    map.on('dblclick', onDoubleClick);

    return () => {
      map.getCanvas().style.cursor = '';
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      map.off('dblclick', onDoubleClick);
    };
  }, [map, mode, paint]);

  const reset = useCallback(() => {
    centerRef.current = null;
    verticesRef.current = [];
    setDraftRadius(null);
    setDraftVertexCount(0);
    setCenterPlaced(false);
  }, []);

  return {
    mode,
    geometry,
    draftRadius,
    centerPlaced,
    draftVertexCount,

    startCircle: useCallback(() => {
      reset();
      setGeometry(null);
      paint(null);
      setMode('circle');
    }, [paint, reset]),

    startPolygon: useCallback(() => {
      reset();
      setGeometry(null);
      paint(null);
      setMode('polygon');
    }, [paint, reset]),

    closePolygon: useCallback(() => {
      if (verticesRef.current.length < 3) return;
      const shape: GeofenceGeometry = { shape: 'polygon', vertices: verticesRef.current };
      setGeometry(shape);
      paint(shape, verticesRef.current);
      setMode('none');
    }, [paint]),

    undoVertex: useCallback(() => {
      verticesRef.current = verticesRef.current.slice(0, -1);
      setDraftVertexCount(verticesRef.current.length);
      const vertices = verticesRef.current;
      paint(vertices.length >= 3 ? { shape: 'polygon', vertices } : null, vertices);
    }, [paint]),

    cancel: useCallback(() => {
      reset();
      setGeometry(null);
      paint(null);
      setMode('none');
    }, [paint, reset]),

    loadGeometry: useCallback(
      (shape: GeofenceGeometry) => {
        reset();
        setGeometry(shape);
        setDraftRadius(shape.shape === 'circle' ? shape.radiusMeters : null);
        paint(shape, shape.shape === 'circle' ? [shape.center] : shape.vertices);
        setMode('none');
      },
      [paint, reset],
    ),
  };
}
