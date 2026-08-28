import { describe, expect, it } from 'vitest';

import {
  isScoped,
  scopePoints,
  scopeRoutes,
  scopeVehicles,
  type ScopeInput,
  type ScopedRoute,
} from './map-scope';
import type { LatLng } from '@/types/core';

/** Cuadrado alrededor de (-33.45, -70.66). */
const COMUNA: LatLng[] = [
  { lat: -33.4, lng: -70.7 },
  { lat: -33.4, lng: -70.6 },
  { lat: -33.5, lng: -70.6 },
  { lat: -33.5, lng: -70.7 },
];

const DENTRO = { lat: -33.45, lng: -70.66 };
const FUERA = { lat: -33.2, lng: -70.9 };

const VEHICULOS = [
  { vehicleId: 'v1', position: DENTRO },
  { vehicleId: 'v2', position: FUERA },
  { vehicleId: 'v3', position: null },
];

const RUTAS: ScopedRoute[] = [
  { routeId: 'r1', vehicleId: 'v1', stops: [DENTRO, { lat: -33.46, lng: -70.65 }] },
  { routeId: 'r2', vehicleId: 'v2', stops: [FUERA] },
];

const LIBRE: ScopeInput = { vehicleId: null, routeId: null, communeBoundary: null };

describe('enfoque del mapa', () => {
  it('sin enfoque no oculta nada', () => {
    expect(isScoped(LIBRE)).toBe(false);
    expect(scopeVehicles(VEHICULOS, LIBRE)).toHaveLength(3);
    expect(scopeRoutes(RUTAS, LIBRE)).toHaveLength(2);
  });

  describe('al aislar un vehiculo', () => {
    const scope: ScopeInput = { ...LIBRE, vehicleId: 'v1' };

    it('deja solo ese vehiculo', () => {
      expect(scopeVehicles(VEHICULOS, scope, RUTAS).map((v) => v.vehicleId)).toEqual(['v1']);
    });

    it('conserva su ruta, que es el contexto de donde va', () => {
      expect(scopeRoutes(RUTAS, scope).map((r) => r.routeId)).toEqual(['r1']);
    });

    it('deja solo los puntos de esa ruta', () => {
      const puntos = [DENTRO, FUERA, { lat: -33.46, lng: -70.65 }];
      expect(scopePoints(puntos, scope, RUTAS)).toHaveLength(2);
    });

    it('lo muestra aunque este fuera de la comuna enfocada', () => {
      // El operador lo eligio: hacerlo desaparecer seria desconcertante.
      const conComuna: ScopeInput = { vehicleId: 'v2', routeId: null, communeBoundary: COMUNA };
      expect(scopeVehicles(VEHICULOS, conComuna, RUTAS).map((v) => v.vehicleId)).toEqual(['v2']);
    });
  });

  describe('al resaltar una ruta', () => {
    const scope: ScopeInput = { ...LIBRE, routeId: 'r1' };

    it('deja solo esa ruta', () => {
      expect(scopeRoutes(RUTAS, scope).map((r) => r.routeId)).toEqual(['r1']);
    });

    it('deja el camion que la ejecuta, no los demas', () => {
      expect(scopeVehicles(VEHICULOS, scope, RUTAS).map((v) => v.vehicleId)).toEqual(['v1']);
    });

    it('no deja ningun vehiculo si la ruta no tiene camion asignado', () => {
      const huerfana: ScopedRoute[] = [{ routeId: 'r9', vehicleId: null, stops: [DENTRO] }];
      expect(scopeVehicles(VEHICULOS, { ...LIBRE, routeId: 'r9' }, huerfana)).toEqual([]);
    });
  });

  describe('al enfocar una comuna', () => {
    const scope: ScopeInput = { ...LIBRE, communeBoundary: COMUNA };

    it('deja solo los vehiculos que estan dentro', () => {
      expect(scopeVehicles(VEHICULOS, scope).map((v) => v.vehicleId)).toEqual(['v1']);
    });

    it('descarta los vehiculos sin posicion conocida', () => {
      // No se puede afirmar que estan en la comuna, asi que no se afirma.
      expect(scopeVehicles(VEHICULOS, scope).some((v) => v.vehicleId === 'v3')).toBe(false);
    });

    it('deja solo los clientes y ordenes dentro del limite', () => {
      expect(scopePoints([DENTRO, FUERA], scope)).toEqual([DENTRO]);
    });

    it('conserva la ruta completa si alguna parada cae dentro', () => {
      // Recortar el trazado partiria el corredor y daria una idea falsa.
      expect(scopeRoutes(RUTAS, scope).map((r) => r.routeId)).toEqual(['r1']);
    });
  });

  it('el vehiculo aislado manda sobre la ruta resaltada', () => {
    const ambos: ScopeInput = { vehicleId: 'v2', routeId: 'r1', communeBoundary: null };
    expect(scopeVehicles(VEHICULOS, ambos, RUTAS).map((v) => v.vehicleId)).toEqual(['v2']);
  });
});
