import { isUsableCoordinate } from '@/lib/geo';
import type { LatLng } from '@/types/core';
import type { JumpToOptions } from 'maplibre-gl';

interface FollowCamera {
  jumpTo(options: JumpToOptions): unknown;
}

/** Centra la cámara en el mismo punto que dibuja el marcador, sin márgenes heredados. */
export function centerFollowedVehicle(camera: FollowCamera, point: LatLng | null | undefined, zoom?: number): boolean {
  if (!point || !isUsableCoordinate(point)) return false;
  camera.jumpTo({ center: [point.lng, point.lat], padding: { top: 0, right: 0, bottom: 0, left: 0 }, ...(zoom === undefined ? {} : { zoom }) });
  return true;
}
