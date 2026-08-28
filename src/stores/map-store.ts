'use client';

import { create } from 'zustand';

import type { MapViewMode } from '@/components/map/map-style';
import type { ClientActivityStatus, LatLng } from '@/types/core';
import type { HeatmapMode } from '@/types/views';

/**
 * Estado del centro operacional.
 *
 * Justifica un store global porque lo comparten piezas que no tienen relacion
 * de padre-hijo: la barra de capas, el panel de filtros, las hojas de detalle,
 * los controles flotantes del mapa y el buscador del header.
 */

export type MapLayerId =
  | 'camiones'
  | 'clientes'
  | 'rutas'
  | 'geocercas'
  | 'calor'
  | 'pedidos'
  | 'alertas'
  | 'comunas';

export interface ClientFilters {
  /** Estados comerciales visibles. */
  statuses: ClientActivityStatus[];
  communeCodes: string[];
  search: string;
  /** Solo clientes con pedido pendiente / solo sin pedido. */
  orderState: 'todos' | 'con_pedido' | 'sin_pedido';
  visitState: 'todos' | 'visitados_hoy' | 'no_visitados';
  /** Rango de dias sin comprar. `null` = sin limite. */
  minDaysSincePurchase: number | null;
  maxDaysSincePurchase: number | null;
  /** Rango de dias sin visita. */
  maxDaysSinceVisit: number | null;
}

export const DEFAULT_CLIENT_FILTERS: ClientFilters = {
  statuses: ['active', 'warning', 'dormant'],
  communeCodes: [],
  search: '',
  orderState: 'todos',
  visitState: 'todos',
  minDaysSincePurchase: null,
  maxDaysSincePurchase: null,
  maxDaysSinceVisit: null,
};

export type MapSelection =
  | { type: 'vehicle'; id: string }
  | { type: 'client'; id: string }
  | { type: 'workOrder'; id: string }
  | { type: 'route'; id: string }
  | null;

export interface MapFocusRequest {
  center: LatLng;
  zoom?: number;
  /** Marca temporal: fuerza a reaccionar aunque el centro se repita. */
  requestedAt: number;
}

interface MapState {
  layers: Record<MapLayerId, boolean>;
  toggleLayer: (layer: MapLayerId) => void;
  setLayer: (layer: MapLayerId, enabled: boolean) => void;

  heatmapMode: HeatmapMode;
  setHeatmapMode: (mode: HeatmapMode) => void;

  filters: ClientFilters;
  setFilters: (updater: Partial<ClientFilters>) => void;
  resetFilters: () => void;
  /** Cantidad de filtros activos, para el distintivo del boton. */
  activeFilterCount: () => number;

  /** Filtro de flota independiente del de clientes. */
  vehicleStatusFilter: string[];
  setVehicleStatusFilter: (statuses: string[]) => void;

  selection: MapSelection;
  select: (selection: MapSelection) => void;

  followingVehicleId: string | null;
  followVehicle: (vehicleId: string | null) => void;

  focus: MapFocusRequest | null;
  focusOn: (center: LatLng, zoom?: number) => void;

  /** Ruta resaltada al abrir "Ver ruta" desde una ficha. */
  highlightedRouteId: string | null;
  highlightRoute: (routeId: string | null) => void;

  /**
   * Aislar en el mapa lo que se esta mirando.
   *
   * Con un vehiculo o una ruta enfocados, el resto de la flota y de la
   * cartera se oculta. Un mapa con todo encima sirve para vigilar; para
   * mirar UNA cosa, estorba. Se puede desactivar desde el propio mapa, para
   * que nunca sea una desaparicion inexplicable.
   */
  isolate: boolean;
  setIsolate: (isolate: boolean) => void;

  /**
   * Comuna a la que se restringe la vista.
   *
   * Distinta de `inspectedCommuneCode`: consultar una comuna no obliga a
   * ocultar el resto del territorio, pero se puede pedir que si.
   */
  scopedCommuneCode: string | null;
  scopeToCommune: (code: string | null) => void;

  /**
   * Comuna abierta en el panel territorial.
   *
   * Distinta del filtro: se puede consultar una comuna sin restringir la
   * vista a ella.
   */
  inspectedCommuneCode: string | null;
  inspectCommune: (code: string | null) => void;

  /** Modo de visualizacion del basemap. */
  viewMode: MapViewMode;
  setViewMode: (mode: MapViewMode) => void;

  /** Capa de congestion vial. */
  trafficEnabled: boolean;
  setTrafficEnabled: (enabled: boolean) => void;
}

export const useMapStore = create<MapState>((set, get) => ({
  layers: {
    camiones: true,
    clientes: true,
    rutas: true,
    geocercas: false,
    calor: false,
    pedidos: false,
    alertas: false,
    comunas: false,
  },
  toggleLayer: (layer) =>
    set((state) => ({ layers: { ...state.layers, [layer]: !state.layers[layer] } })),
  setLayer: (layer, enabled) =>
    set((state) => ({ layers: { ...state.layers, [layer]: enabled } })),

  heatmapMode: 'clients',
  setHeatmapMode: (mode) => set({ heatmapMode: mode }),

  filters: DEFAULT_CLIENT_FILTERS,
  setFilters: (updater) => set((state) => ({ filters: { ...state.filters, ...updater } })),
  resetFilters: () => set({ filters: DEFAULT_CLIENT_FILTERS }),
  activeFilterCount: () => {
    const { filters } = get();
    let count = 0;
    if (filters.statuses.length !== 3) count += 1;
    if (filters.communeCodes.length > 0) count += 1;
    if (filters.search.trim().length > 0) count += 1;
    if (filters.orderState !== 'todos') count += 1;
    if (filters.visitState !== 'todos') count += 1;
    if (filters.minDaysSincePurchase !== null || filters.maxDaysSincePurchase !== null) count += 1;
    if (filters.maxDaysSinceVisit !== null) count += 1;
    return count;
  },

  vehicleStatusFilter: [],
  setVehicleStatusFilter: (statuses) => set({ vehicleStatusFilter: statuses }),

  selection: null,
  select: (selection) => set({ selection }),

  followingVehicleId: null,
  followVehicle: (vehicleId) =>
    set({
      followingVehicleId: vehicleId,
      // Seguir un vehiculo implica seleccionarlo: son la misma intencion.
      selection: vehicleId ? { type: 'vehicle', id: vehicleId } : null,
    }),

  focus: null,
  focusOn: (center, zoom) => set({ focus: { center, zoom, requestedAt: Date.now() } }),

  highlightedRouteId: null,
  highlightRoute: (routeId) => set({ highlightedRouteId: routeId }),

  isolate: true,
  setIsolate: (isolate) => set({ isolate }),

  scopedCommuneCode: null,
  scopeToCommune: (code) =>
    set({
      scopedCommuneCode: code,
      // Enfocar una comuna abre tambien su ficha: son la misma intencion.
      inspectedCommuneCode: code,
      // Y libera cualquier aislamiento previo, que competiria con este.
      selection: null,
      followingVehicleId: null,
      highlightedRouteId: null,
    }),

  inspectedCommuneCode: null,
  inspectCommune: (code) => set({ inspectedCommuneCode: code }),

  // El mapa aprobado sigue siendo el predeterminado: los otros modos se
  // eligen, nunca se imponen.
  viewMode: 'standard',
  setViewMode: (mode) => set({ viewMode: mode }),

  trafficEnabled: false,
  setTrafficEnabled: (enabled) => set({ trafficEnabled: enabled }),
}));
