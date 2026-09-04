import type { StyleSpecification } from 'maplibre-gl';

/**
 * Proveedor de cartografia desacoplado.
 *
 * El mapa NUNCA construye su estilo en linea: pide uno a este modulo. Cambiar
 * de proveedor (OpenStreetMap, MapTiler, Mapbox u otro compatible) es cambiar
 * una variable de entorno, sin tocar capas, interacciones ni componentes.
 *
 * Nota sobre licenciamiento: los proveedores sin clave incluidos aqui sirven
 * para desarrollo y demostracion. Para produccion comercial, Fenice debe
 * contratar una clave (MapTiler o Mapbox) y fijar `NEXT_PUBLIC_MAP_PROVIDER`
 * en consecuencia; la arquitectura ya lo soporta.
 */

export type MapProviderId = 'carto-light' | 'osm' | 'esri' | 'maptiler' | 'mapbox';

/**
 * Modo de visualizacion del mapa.
 *
 *  - `standard` es el mapa aprobado y sigue siendo el predeterminado.
 *  - `satellite` e `hybrid` usan imagineria de Esri, que no exige clave.
 *  - `dark` sirve para turnos de noche sin alterar la identidad del sistema.
 */
export type MapViewMode = 'standard' | 'satellite' | 'hybrid' | 'dark';

export const MAP_VIEW_LABEL: Record<MapViewMode, string> = {
  standard: 'Estandar',
  satellite: 'Satelite',
  hybrid: 'Hibrido',
  dark: 'Nocturno',
};

export interface MapProviderConfig {
  id: MapProviderId;
  label: string;
  /** `true` cuando el estilo es vectorial (mejor rendimiento y nitidez). */
  vector: boolean;
  requiresKey: boolean;
  attribution: string;
}

export const MAP_PROVIDERS: Record<MapProviderId, MapProviderConfig> = {
  osm: {
    id: 'osm',
    label: 'OpenStreetMap',
    vector: false,
    requiresKey: false,
    attribution: '&copy; OpenStreetMap contributors',
  },
  esri: {
    id: 'esri',
    label: 'Esri World Imagery',
    vector: false,
    // Imagineria satelital SIN clave. Es lo que permite ofrecer la vista
    // satelital en Plan Basico sin contratar nada.
    requiresKey: false,
    attribution:
      'Imagineria &copy; Esri, Maxar, Earthstar Geographics y la comunidad de usuarios GIS',
  },
  'carto-light': {
    id: 'carto-light',
    label: 'CARTO Positron',
    vector: false,
    // CARTO pasa a exigir clave: sus teselas devuelven 200 pero con la marca
    // de agua "API KEY REQUIRED" incrustada en la imagen.
    requiresKey: true,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  },
  maptiler: {
    id: 'maptiler',
    label: 'MapTiler',
    vector: true,
    requiresKey: true,
    attribution: '&copy; MapTiler &copy; OpenStreetMap contributors',
  },
  mapbox: {
    id: 'mapbox',
    label: 'Mapbox',
    vector: true,
    requiresKey: true,
    attribution: '&copy; Mapbox &copy; OpenStreetMap contributors',
  },
};

/**
 * Ajuste cromatico del basemap raster.
 *
 * El mapa es el fondo sobre el que se leen camiones, clientes y rutas: se
 * desatura y se aclara ligeramente para que los datos operacionales
 * concentren todo el color de la pantalla.
 */
/**
 * Ajuste del basemap para turnos de noche.
 *
 * Invierte el brillo y desatura fuerte: reduce el deslumbramiento en una sala
 * de control a oscuras sin cambiar la identidad del resto del sistema.
 */
const NIGHT_TONE = {
  'raster-saturation': -0.95,
  'raster-contrast': 0.25,
  'raster-brightness-min': 0.75,
  'raster-brightness-max': 0.08,
  'raster-opacity': 0.9,
} as const;

const RASTER_TONE = {
  // Desaturacion fuerte: el basemap debe ser una guia de calles, no una
  // competencia visual. Los verdes de parque y los rojos de autopista de
  // OpenStreetMap tapan a los camiones y a los pines de cliente.
  'raster-saturation': -0.92,
  'raster-contrast': -0.18,
  'raster-brightness-min': 0.32,
  'raster-brightness-max': 1,
} as const;

function rasterStyle(
  tiles: string[],
  attribution: string,
  options: { toned: boolean; night?: boolean },
): StyleSpecification {
  return {
    version: 8,
    /**
     * Servidor de glifos de las etiquetas.
     *
     * TRAMPA IMPORTANTE: si este endpoint devuelve HTML en lugar de un
     * protobuf (algunos servidores responden 200 con una pagina de error para
     * fuentes que no tienen), MapLibre intenta parsear esa pagina como
     * protobuf, el bucket de simbolos revienta y se pierde el TILE ENTERO,
     * arrastrando tambien a los circulos y los iconos de la misma fuente. El
     * sintoma es un mapa sin clientes ni paradas, sin ningun error visible.
     *
     * Por eso solo se piden fuentes SUELTAS que este servidor tiene: las
     * pilas compuestas ("A,B,C") responden 404 con HTML.
     */
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'raster',
        tiles,
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': options.night ? '#0a1220' : '#eef2f7' },
      },
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
        paint: options.night
          ? NIGHT_TONE
          : options.toned
            ? { 'raster-opacity': 0.95, ...RASTER_TONE }
            : { 'raster-opacity': 1 },
      },
    ],
  };
}

export interface ResolvedMapStyle {
  style: StyleSpecification | string;
  provider: MapProviderConfig;
  /** Motivo por el que se cayo al proveedor por defecto, si aplica. */
  fallbackReason: string | null;
}

/** Modos disponibles con la configuracion actual. */
export interface MapViewAvailability {
  mode: MapViewMode;
  available: boolean;
  /** Motivo, listo para mostrar, cuando el modo no esta disponible. */
  reason: string | null;
}

/**
 * Estilo satelital de Esri, sin clave.
 *
 * El modo hibrido superpone la capa de referencia (nombres de calles, limites
 * y lugares) sobre la imagineria. Sin ella, el satelite es bonito pero
 * inutil para operar: nadie reconoce una direccion sin el nombre de la calle.
 */
function esriStyle(withLabels: boolean): StyleSpecification {
  const IMAGERY =
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const REFERENCE =
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

  const style: StyleSpecification = {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      basemap: {
        type: 'raster',
        tiles: [IMAGERY],
        tileSize: 256,
        maxzoom: 19,
        attribution: MAP_PROVIDERS.esri.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b1b2b' } },
      { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 1 } },
    ],
  };

  if (withLabels) {
    style.sources.labels = {
      type: 'raster',
      tiles: [REFERENCE],
      tileSize: 256,
      maxzoom: 19,
      attribution: MAP_PROVIDERS.esri.attribution,
    };
    style.layers.push({ id: 'labels', type: 'raster', source: 'labels' });
  }

  return style;
}

/**
 * Que modos de vista puede ofrecer la configuracion actual.
 *
 * Los cuatro estan SIEMPRE disponibles: satelite e hibrido se sirven con
 * imagineria de Esri, que no exige clave ni contrato. Una clave de MapTiler o
 * Mapbox mejora la nitidez y el rendimiento (teselas vectoriales), pero no
 * hace falta para tener satelite.
 */
export function getAvailableViewModes(): MapViewAvailability[] {
  return [
    { mode: 'standard', available: true, reason: null },
    { mode: 'satellite', available: true, reason: null },
    { mode: 'hybrid', available: true, reason: null },
    { mode: 'dark', available: true, reason: null },
  ];
}

/**
 * Resuelve el estilo activo. Si el proveedor configurado requiere clave y no
 * la hay, degrada al basemap sin clave e informa el motivo en vez de dejar el
 * mapa en blanco.
 */
export function resolveMapStyle(mode: MapViewMode = 'standard'): ResolvedMapStyle {
  const maptilerKeyForView = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mapboxTokenForView = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // --- Modo nocturno: no requiere clave -----------------------------------
  if (mode === 'dark') {
    return {
      style: rasterStyle(
        [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
        ],
        MAP_PROVIDERS.osm.attribution,
        { toned: true, night: true },
      ),
      provider: MAP_PROVIDERS.osm,
      fallbackReason: null,
    };
  }

  // --- Satelite e hibrido -------------------------------------------------
  //
  // Con clave contratada se usan teselas vectoriales, que son mas nitidas al
  // acercarse. Sin clave se cae a Esri, que es imagineria libre y suficiente
  // para reconocer una planta, un acceso o una playa de carga.
  if (mode === 'satellite' || mode === 'hybrid') {
    if (maptilerKeyForView) {
      return {
        style: `https://api.maptiler.com/maps/${mode === 'hybrid' ? 'hybrid' : 'satellite'}/style.json?key=${maptilerKeyForView}`,
        provider: MAP_PROVIDERS.maptiler,
        fallbackReason: null,
      };
    }
    if (mapboxTokenForView) {
      return {
        style: `https://api.mapbox.com/styles/v1/mapbox/${mode === 'hybrid' ? 'satellite-streets-v12' : 'satellite-v9'}?access_token=${mapboxTokenForView}`,
        provider: MAP_PROVIDERS.mapbox,
        fallbackReason: null,
      };
    }

    return {
      style: esriStyle(mode === 'hybrid'),
      provider: MAP_PROVIDERS.esri,
      fallbackReason: null,
    };
  }

  return resolveStandardStyle();
}

function resolveStandardStyle(): ResolvedMapStyle {
  const requested = (process.env.NEXT_PUBLIC_MAP_PROVIDER ?? 'osm') as MapProviderId;
  const maptilerKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const provider = MAP_PROVIDERS[requested] ?? MAP_PROVIDERS.osm;

  if (provider.id === 'maptiler') {
    if (!maptilerKey) {
      return {
        ...resolveDefault(),
        fallbackReason: 'MapTiler requiere NEXT_PUBLIC_MAPTILER_KEY.',
      };
    }
    return {
      style: `https://api.maptiler.com/maps/streets-v2-light/style.json?key=${maptilerKey}`,
      provider,
      fallbackReason: null,
    };
  }

  if (provider.id === 'mapbox') {
    if (!mapboxToken) {
      return {
        ...resolveDefault(),
        fallbackReason: 'Mapbox requiere NEXT_PUBLIC_MAPBOX_TOKEN.',
      };
    }
    return {
      style: `https://api.mapbox.com/styles/v1/mapbox/light-v11?access_token=${mapboxToken}`,
      provider,
      fallbackReason: null,
    };
  }

  if (provider.id === 'carto-light') {
    // Se mantiene disponible por si Fenice contrata CARTO, pero no puede ser
    // el proveedor por defecto sin clave.
    return {
      ...resolveDefault(),
      fallbackReason: 'CARTO requiere clave de API.',
    };
  }

  return resolveDefault();
}

/**
 * Basemap por defecto: OpenStreetMap, sin clave y sin marca de agua.
 *
 * Se desatura y aclara para que el mapa sea un fondo legible y el color de la
 * pantalla quede reservado a camiones, clientes y rutas.
 */
function resolveDefault(): ResolvedMapStyle {
  return {
    style: rasterStyle(
      [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      MAP_PROVIDERS.osm.attribution,
      { toned: true },
    ),
    provider: MAP_PROVIDERS.osm,
    fallbackReason: null,
  };
}
