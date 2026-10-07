import { pointInPolygon } from '@/lib/geo';
import type { LatLng } from '@/types/core';

/**
 * Que se muestra en el mapa cuando el operador se concentra en algo.
 *
 * Un mapa con doce camiones, quinientos clientes y nueve rutas encima es util
 * para vigilar, pero inutil para mirar UNA cosa. Cuando el operador elige un
 * vehiculo, una ruta o una comuna, lo demas estorba.
 *
 * Este modulo decide que sobrevive a esa concentracion. Es puro: recibe los
 * conjuntos y devuelve los conjuntos filtrados, sin tocar el mapa ni el
 * estado. Asi la misma regla vale para el mapa operacional, la torre y
 * cualquier mapa embebido, y se puede probar.
 */

export interface ScopeInput {
  /** Vehiculo aislado, si el operador selecciono uno. */
  vehicleId: string | null;
  /** Ruta resaltada, si la hay. */
  routeId: string | null;
  /** Comuna a la que se restringe la vista. */
  communeBoundary: LatLng[] | null;
}

/** La ficha de un vehiculo siempre tiene prioridad sobre filtros generales. */
export function resolveMapScope(scope: ScopeInput, isolate: boolean): ScopeInput {
  if (scope.vehicleId !== null) {
    return { vehicleId: scope.vehicleId, routeId: null, communeBoundary: null };
  }
  return isolate ? scope : { vehicleId: null, routeId: null, communeBoundary: null };
}

/** Lo minimo que este motor necesita saber de cada entidad. */
export interface ScopedVehicle {
  vehicleId: string;
  position: { lat: number; lng: number } | null;
}
export interface ScopedRoute {
  routeId: string;
  vehicleId: string | null;
  stops: { lat: number; lng: number }[];
}
export interface ScopedPoint {
  lat: number;
  lng: number;
}

/** `true` si el enfoque restringe algo. */
export function isScoped(scope: ScopeInput): boolean {
  return scope.vehicleId !== null || scope.routeId !== null || scope.communeBoundary !== null;
}

function insideCommune(point: ScopedPoint | null, boundary: LatLng[] | null): boolean {
  if (boundary === null) return true;
  if (point === null) return false;
  return pointInPolygon({ lat: point.lat, lng: point.lng }, boundary);
}

/**
 * Vehiculos visibles.
 *
 * Con un vehiculo aislado se muestra SOLO ese, aunque no este en la comuna
 * enfocada: el operador lo eligio de forma explicita y hacerlo desaparecer
 * seria desconcertante.
 *
 * Con una ruta resaltada se muestra el vehiculo que la ejecuta, porque una
 * ruta sin su camion no dice donde va el trabajo.
 */
export function scopeVehicles<T extends ScopedVehicle>(
  vehicles: T[],
  scope: ScopeInput,
  routes: ScopedRoute[] = [],
): T[] {
  if (scope.vehicleId !== null) {
    return vehicles.filter((v) => v.vehicleId === scope.vehicleId);
  }

  if (scope.routeId !== null) {
    const route = routes.find((r) => r.routeId === scope.routeId);
    return route?.vehicleId ? vehicles.filter((v) => v.vehicleId === route.vehicleId) : [];
  }

  return vehicles.filter((v) => insideCommune(v.position, scope.communeBoundary));
}

/**
 * Rutas visibles.
 *
 * Aislar un vehiculo deja a la vista su ruta: es el contexto que explica
 * por que esta donde esta.
 */
export function scopeRoutes<T extends ScopedRoute>(routes: T[], scope: ScopeInput): T[] {
  if (scope.vehicleId !== null) return routes.filter((r) => r.vehicleId === scope.vehicleId);
  if (scope.routeId !== null) return routes.filter((r) => r.routeId === scope.routeId);

  if (scope.communeBoundary !== null) {
    // Una ruta pertenece a la comuna si alguna de sus paradas cae dentro.
    // Recortar el trazado partiria el corredor y daria una idea falsa del
    // recorrido real.
    return routes.filter((r) =>
      r.stops.some((stop) => insideCommune(stop, scope.communeBoundary)),
    );
  }

  return routes;
}

/**
 * Puntos visibles (clientes y ordenes de trabajo).
 *
 * Al aislar un vehiculo o una ruta, solo quedan los puntos de esa ruta: el
 * resto de la cartera no aporta nada a la pregunta que se esta mirando.
 */
export function scopePoints<T extends ScopedPoint>(
  points: T[],
  scope: ScopeInput,
  routes: ScopedRoute[] = [],
  keyOf?: (point: T) => string | null,
): T[] {
  if (scope.vehicleId !== null || scope.routeId !== null) {
    const focusedRoutes = scopeRoutes(routes, scope);
    const permitidos = new Set(focusedRoutes.flatMap((r) => r.stops.map((s) => `${s.lat},${s.lng}`)));
    return points.filter((p) => permitidos.has(keyOf?.(p) ?? `${p.lat},${p.lng}`));
  }

  // Sin vehiculo ni ruta enfocados, manda la comuna.
  return points.filter((p) => insideCommune(p, scope.communeBoundary));
}
