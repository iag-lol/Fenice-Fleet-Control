import { beforeEach, expect, it, vi } from 'vitest';
import { centerFollowedVehicle } from './map-follow-camera';
import { useMapStore } from '@/stores/map-store';

beforeEach(() => useMapStore.setState(useMapStore.getInitialState(), true));

it('new GPS positions keep the camera centered after closing the sheet, without retaining route padding or changing zoom', () => {
  const jumpTo = vi.fn();
  const camera = { jumpTo };
  useMapStore.getState().followVehicle('truck', { showDetails: false });
  for (const [lat, lng] of [[-33.45, -70.65], [-33.451, -70.651], [-33.452, -70.652]]) {
    useMapStore.getState().closeDetail();
    expect(useMapStore.getState().followingVehicleId).toBe('truck');
    expect(centerFollowedVehicle(camera, { lat: lat!, lng: lng! })).toBe(true);
    expect(jumpTo).toHaveBeenLastCalledWith({ center: [lng, lat], padding: { top: 0, right: 0, bottom: 0, left: 0 } });
  }
  expect(jumpTo).toHaveBeenCalledTimes(3);
});

it('never moves the camera to missing or invalid positions', () => {
  const camera = { jumpTo: vi.fn() };
  for (const point of [null, undefined, { lat: 0, lng: 0 }, { lat: NaN, lng: -70 }, { lat: 91, lng: -70 }]) {
    expect(centerFollowedVehicle(camera, point)).toBe(false);
  }
  expect(camera.jumpTo).not.toHaveBeenCalled();
});
