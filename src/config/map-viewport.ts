import bounds from '@/data/map-viewport.json';
import type { LatLng } from '@/types/core';

/** Gran Santiago: independiente de los poligonos que se sirven por API. */
export const OPERATION_CENTER: LatLng = { lat: -33.47, lng: -70.68 };
export const OPERATION_BOUNDS = bounds;
