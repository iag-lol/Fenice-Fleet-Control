import 'server-only';

import { COMMUNES } from '@/data/communes';
import { normalizeSearch } from '@/lib/format';
import { isUsableCoordinate } from '@/lib/geo';
import { geofencePoints } from '@/lib/map-navigation';
import { getOperationsProvider } from '@/services/registry';
import type { GlobalSearchResult } from '@/types/views';

/**
 * Buscador global. Cubre cliente, RUT, codigo, patente, OT, pedido, direccion
 * geocerca y comuna, y devuelve siempre un destino navegable y, cuando existe, una
 * coordenada para la accion "Ver en mapa".
 */

const MAX_PER_KIND = 6;

export async function searchGlobal(rawQuery: string): Promise<GlobalSearchResult[]> {
  const term = normalizeSearch(rawQuery);
  if (term.length < 2) return [];

  const operations = getOperationsProvider();
  const [clients, vehicles, workOrders, routes, geofences] = await Promise.all([
    operations.getClients(),
    operations.getVehicles(),
    operations.getWorkOrders({ limit: 800 }),
    operations.getRoutes(),
    operations.getGeofences(),
  ]);

  const results: GlobalSearchResult[] = [];

  // --- Clientes -------------------------------------------------------------
  const clientMatches = clients
    .filter((client) => {
      const location = client.locations.find((l) => l.isPrimary) ?? client.locations[0];
      return (
        normalizeSearch(client.tradeName).includes(term) ||
        normalizeSearch(client.legalName).includes(term) ||
        normalizeSearch(client.code).includes(term) ||
        normalizeSearch(client.taxId).includes(term) ||
        (location ? normalizeSearch(location.addressLine).includes(term) : false)
      );
    })
    .slice(0, MAX_PER_KIND);

  for (const client of clientMatches) {
    const location = client.locations.find((l) => l.isPrimary) ?? client.locations[0] ?? null;
    results.push({
      id: client.id,
      kind: 'cliente',
      title: client.tradeName,
      subtitle: `${client.code} · ${location?.communeName ?? 'Sin comuna'} · ${location?.addressLine ?? 'Sin direccion'}`,
      href: `/clientes/${client.id}`,
      position: isUsableCoordinate(location?.coordinates) ? location!.coordinates : null,
      mapFocus: { type: 'client', id: client.id },
    });
  }

  // --- Vehiculos ------------------------------------------------------------
  for (const vehicle of vehicles
    .filter(
      (v) =>
        normalizeSearch(v.plate).includes(term) ||
        normalizeSearch(v.fleetCode).includes(term) ||
        normalizeSearch(`${v.brand} ${v.model}`).includes(term),
    )
    .slice(0, MAX_PER_KIND)) {
    results.push({
      id: vehicle.id,
      kind: 'vehiculo',
      title: `${vehicle.plate} · ${vehicle.fleetCode}`,
      subtitle: `${vehicle.brand} ${vehicle.model} · ${vehicle.depotName}`,
      href: `/flota/${vehicle.id}`,
      position: null,
      mapFocus: { type: 'vehicle', id: vehicle.id },
    });
  }

  // --- Ordenes de trabajo y pedidos ----------------------------------------
  for (const workOrder of workOrders
    .filter(
      (w) =>
        normalizeSearch(w.number).includes(term) ||
        normalizeSearch(w.orderNumber).includes(term) ||
        normalizeSearch(w.clientName).includes(term) ||
        normalizeSearch(w.addressLine).includes(term),
    )
    .slice(0, MAX_PER_KIND * 2)) {
    const matchedByOrder =
      normalizeSearch(workOrder.orderNumber).includes(term) &&
      !normalizeSearch(workOrder.number).includes(term);

    results.push({
      id: workOrder.id,
      kind: matchedByOrder ? 'pedido' : 'orden',
      title: matchedByOrder ? workOrder.orderNumber : workOrder.number,
      subtitle: `${workOrder.clientName} · ${workOrder.communeName} · ${workOrder.addressLine}`,
      href: `/ordenes/${workOrder.id}`,
      position: isUsableCoordinate(workOrder.coordinates) ? workOrder.coordinates : null,
      mapFocus: { type: 'workOrder', id: workOrder.id },
    });
  }

  // --- Rutas ----------------------------------------------------------------
  for (const route of routes
    .filter((r) => normalizeSearch(r.code).includes(term) || normalizeSearch(r.name).includes(term))
    .slice(0, MAX_PER_KIND)) {
    results.push({
      id: route.id,
      kind: 'ruta',
      title: `${route.code} · ${route.name}`,
      subtitle: `${route.stops.length} paradas · ${route.plannedDistanceKm} km planificados`,
      href: `/rutas/${route.id}`,
      position: route.plannedPath[0] ?? null,
      mapFocus: { type: 'route', id: route.id },
    });
  }

  // --- Geocercas ------------------------------------------------------------
  for (const geofence of geofences
    .filter(
      (entry) =>
        normalizeSearch(entry.name).includes(term) ||
        normalizeSearch(entry.description ?? '').includes(term) ||
        normalizeSearch(entry.communeCode ?? '').includes(term),
    )
    .slice(0, MAX_PER_KIND)) {
    const points = geofencePoints(geofence);
    const position =
      geofence.geometry.shape === 'circle'
        ? geofence.geometry.center
        : points.length > 0
          ? {
              lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
              lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
            }
          : null;

    results.push({
      id: geofence.id,
      kind: 'geocerca',
      title: geofence.name,
      subtitle: `${geofence.active ? 'Activa' : 'Inactiva'} · ${geofence.communeCode ?? 'Sin comuna'}`,
      href: '/control',
      position,
      mapFocus: { type: 'geofence', id: geofence.id },
    });
  }

  // --- Comunas --------------------------------------------------------------
  for (const commune of COMMUNES.filter((c) => normalizeSearch(c.name).includes(term)).slice(
    0,
    MAX_PER_KIND,
  )) {
    results.push({
      id: commune.code,
      kind: 'comuna',
      title: commune.name,
      subtitle: commune.region,
      href: `/territorio?comuna=${encodeURIComponent(commune.code)}`,
      position: commune.center,
      mapFocus: { type: 'commune', id: commune.code },
    });
  }

  return results;
}
