import { beforeEach, describe, expect, it } from 'vitest';
import { useMapStore } from '@/stores/map-store';

beforeEach(() => useMapStore.setState(useMapStore.getInitialState(), true));

describe('control tower navigation', () => {
  it('starts with only fleet and geofences visible, and does not isolate on selection', () => {
    const state = useMapStore.getState();
    for (const layer of ['camiones', 'geocercas'] as const) expect(state.layers[layer]).toBe(true);
    for (const layer of ['clientes', 'comunas', 'pedidos', 'alertas', 'rutas', 'calor'] as const) {
      expect(state.layers[layer]).toBe(false);
    }
    state.select({ type: 'vehicle', id: 'truck' });
    expect(useMapStore.getState().isolate).toBe(false);
  });
  it('restores all entities, layers and filters with show all', () => {
    const state = useMapStore.getState();
    state.setFilters({ search: 'oculto', statuses: [] });
    state.setLayer('clientes', false);
    state.scopeToCommune('13101');
    state.followVehicle('truck');
    state.showAll();
    const reset = useMapStore.getState();
    expect(reset.filters.search).toBe('');
    expect(reset.filters.statuses).toHaveLength(3);
    expect(reset.layers.clientes).toBe(true);
    expect(reset.isolate).toBe(false);
    expect(reset.selection).toBeNull();
    expect(reset.followingVehicleId).toBeNull();
    expect(reset.scopedCommuneCode).toBeNull();
  });
  it('opens dispatches and geofences with their layers enabled, and releases the followed truck', () => {
    for (const [type, layer] of [['workOrder', 'pedidos'], ['geofence', 'geocercas'], ['alert', 'alertas'], ['route', 'rutas']] as const) {
      useMapStore.getState().setLayer(layer, false);
      useMapStore.getState().followVehicle('truck');
      useMapStore.getState().select({ type, id: 'entity' });
      expect(useMapStore.getState().selection).toEqual({ type, id: 'entity' });
      expect(useMapStore.getState().layers[layer]).toBe(true);
      expect(useMapStore.getState().followingVehicleId).toBeNull();
    }
  });
  it('explicit commune isolation still works and enables its boundaries', () => {
    useMapStore.getState().scopeToCommune('13101');
    expect(useMapStore.getState().isolate).toBe(true);
    expect(useMapStore.getState().scopedCommuneCode).toBe('13101');
  });
  it('ignores invalid camera targets and releases follow for an explicit fit', () => {
    useMapStore.getState().focusOn({ lat: 0, lng: 0 });
    expect(useMapStore.getState().focus).toBeNull();
    useMapStore.getState().followVehicle('truck');
    useMapStore.getState().fitPoints([{ lat: -33, lng: -70 }, { lat: -34, lng: -71 }]);
    expect(useMapStore.getState().followingVehicleId).toBeNull();
    expect(useMapStore.getState().focus?.bounds).toEqual({ minLat: -34, maxLat: -33, minLng: -71, maxLng: -70 });
  });
});
