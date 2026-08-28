import 'server-only';

import { getCommuneForPoint } from '@/data/communes';
import { isUsableCoordinate } from '@/lib/geo';
import { loadClientContext } from '@/services/aggregation/client-aggregator';
import { loadFleetContext } from '@/services/aggregation/fleet-aggregator';
import { getOperationsProvider } from '@/services/registry';

/**
 * Resumen operacional por comuna.
 *
 * Alimenta el panel que se abre al pulsar una comuna en el mapa. Todas las
 * cifras se resuelven por GEOMETRIA, no por el texto de la direccion: el
 * nombre de comuna que viene en una direccion es dato de captura y puede
 * estar mal escrito o desactualizado.
 */

export interface CommuneOperationalSummary {
  communeCode: string;
  communeName: string;
  clients: number;
  activeClients: number;
  warningClients: number;
  dormantClients: number;
  /** Vehiculos que se encuentran dentro de la comuna en este momento. */
  vehiclesInside: number;
  /** Ordenes de trabajo programadas para hoy en la comuna. */
  workOrdersToday: number;
  deliveredToday: number;
  pendingToday: number;
  openAlerts: number;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Resumen por codigo de comuna, listo para consulta directa. */
export async function loadCommuneOperationalSummary(): Promise<
  Record<string, CommuneOperationalSummary>
> {
  const operations = getOperationsProvider();
  const now = new Date();

  const [clientContext, fleetContext, alerts] = await Promise.all([
    loadClientContext(),
    loadFleetContext(),
    operations.getAlerts({ states: ['nueva', 'revisada'] }),
  ]);

  const summary: Record<string, CommuneOperationalSummary> = {};

  const ensure = (code: string, name: string): CommuneOperationalSummary => {
    const existing = summary[code];
    if (existing) return existing;

    const created: CommuneOperationalSummary = {
      communeCode: code,
      communeName: name,
      clients: 0,
      activeClients: 0,
      warningClients: 0,
      dormantClients: 0,
      vehiclesInside: 0,
      workOrdersToday: 0,
      deliveredToday: 0,
      pendingToday: 0,
      openAlerts: 0,
    };
    summary[code] = created;
    return created;
  };

  // --- Cartera ---------------------------------------------------------------
  for (const snapshot of clientContext.snapshots) {
    const location = snapshot.primaryLocation;
    if (!location || !isUsableCoordinate(location.coordinates)) continue;

    const commune = getCommuneForPoint(location.coordinates.lat, location.coordinates.lng);
    if (!commune) continue;

    const entry = ensure(commune.code, commune.name);
    entry.clients += 1;
    if (snapshot.activityStatus === 'active') entry.activeClients += 1;
    else if (snapshot.activityStatus === 'warning') entry.warningClients += 1;
    else entry.dormantClients += 1;
  }

  // --- Vehiculos presentes ---------------------------------------------------
  for (const position of fleetContext.positions.values()) {
    const commune = getCommuneForPoint(position.lat, position.lng);
    if (!commune) continue;
    ensure(commune.code, commune.name).vehiclesInside += 1;
  }

  // --- Despachos del dia -----------------------------------------------------
  for (const workOrder of fleetContext.workOrders) {
    if (!isSameDay(new Date(workOrder.scheduledDate), now)) continue;
    if (!isUsableCoordinate(workOrder.coordinates)) continue;

    const commune = getCommuneForPoint(workOrder.coordinates.lat, workOrder.coordinates.lng);
    if (!commune) continue;

    const entry = ensure(commune.code, commune.name);
    entry.workOrdersToday += 1;

    if (['visita_detectada', 'completada'].includes(workOrder.status)) entry.deliveredToday += 1;
    else if (workOrder.status !== 'cancelada') entry.pendingToday += 1;
  }

  // --- Alertas georreferenciadas ---------------------------------------------
  for (const alert of alerts) {
    if (!isUsableCoordinate(alert.position)) continue;
    const commune = getCommuneForPoint(alert.position.lat, alert.position.lng);
    if (!commune) continue;
    ensure(commune.code, commune.name).openAlerts += 1;
  }

  return summary;
}
