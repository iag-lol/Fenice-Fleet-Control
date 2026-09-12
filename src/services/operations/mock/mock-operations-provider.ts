import 'server-only';

import { getOperationalSettings } from '@/services/settings/settings-store';
import { COMMUNES } from '@/data/communes';
import { getDemoDataset as getDataset, isDemoMode } from '@/demo';
import { calculateClientActivityStatus } from '@/lib/engines/client-activity';
import {
  calculateDwellTime,
  evaluateDeliveryVisit,
  geofenceCenter,
} from '@/lib/engines/geofence-engine';
import { evaluateCommuneCompliance, evaluateRouteDeviation } from '@/lib/engines/route-compliance';
import { evaluateConnectionState } from '@/lib/engines/gps-health';
import { haversineMeters } from '@/lib/geo';
import { normalizeSearch } from '@/lib/format';
import { listGeofences } from '@/services/geofences/geofence-store';
import { listAlerts as listRealAlerts } from '@/services/fleet/alert-store';
import { listDrivers } from '@/services/fleet/driver-store';
import { listVehicles } from '@/services/fleet/vehicle-store';
import { fleetSimulator } from '@/services/gps/mock/simulator';
import type {
  AlertQuery,
  ClientQuery,
  ExternalOperationsProvider,
  OperationsProviderInfo,
  OrderQuery,
  RouteQuery,
  WorkOrderQuery,
} from '@/services/operations/operations-provider';
import {
  asAlertId,
  type Alert,
  type AlertId,
  type AlertState,
  type Client,
  type ClientId,
  type Commune,
  type CustomerVisit,
  type Driver,
  type Geofence,
  type GeofenceEvent,
  type Order,
  type OrderId,
  type Route,
  type RouteId,
  type RouteStop,
  type Vehicle,
  type WorkOrder,
  type WorkOrderId,
  type WorkOrderStatus,
} from '@/types/core';

/**
 * Proveedor operacional de demostracion.
 *
 * Combina el dataset estatico con el estado vivo del simulador: las OT avanzan
 * segun las paradas que el vehiculo realmente visito, y las alertas se derivan
 * de los motores de reglas sobre la telemetria simulada. No son datos
 * decorativos: recorren el mismo camino que recorreran los datos reales.
 */

/** Estado de alertas resueltas/revisadas. Artefacto propio de la plataforma. */
const alertStateOverrides = new Map<string, { state: AlertState; at: string }>();

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

interface LiveRouteState {
  route: Route;
  workOrders: WorkOrder[];
}

export class MockOperationsProvider implements ExternalOperationsProvider {
  /**
   * La etiqueta refleja lo que este proveedor SIRVE, no como se llama.
   *
   * Con la demostracion apagada devuelve un mundo vacio: anunciarlo como
   * "datos de demostracion" haria creer al operador que esta viendo un
   * simulacro, cuando en realidad no esta viendo nada y lo que falta es
   * conectar la base de Fenice.
   */
  readonly info: OperationsProviderInfo = {
    id: 'mock',
    label: isDemoMode() ? 'Datos de demostracion' : 'Sin fuente conectada',
    simulated: isDemoMode(),
    readOnly: true,
  };

  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    const started = performance.now();
    getDataset();
    return {
      ok: true,
      message: 'Dataset de demostracion cargado. Sin conexion a la base de Fenice.',
      latencyMs: Math.round(performance.now() - started),
    };
  }

  async getCommunes(): Promise<Commune[]> {
    return [...COMMUNES];
  }

  // -------------------------------------------------------------------------
  // Clientes
  // -------------------------------------------------------------------------

  async getClients(query: ClientQuery = {}): Promise<Client[]> {
    const dataset = getDataset();
    let clients = dataset.clients;

    if (query.clientIds?.length) {
      const wanted = new Set(query.clientIds as string[]);
      clients = clients.filter((c) => wanted.has(c.id));
    }

    if (query.communeCodes?.length) {
      const wanted = new Set(query.communeCodes);
      clients = clients.filter((c) => c.locations.some((l) => wanted.has(l.communeCode)));
    }

    if (query.search) {
      const term = normalizeSearch(query.search);
      clients = clients.filter(
        (c) =>
          normalizeSearch(c.tradeName).includes(term) ||
          normalizeSearch(c.legalName).includes(term) ||
          normalizeSearch(c.code).includes(term) ||
          normalizeSearch(c.taxId).includes(term) ||
          c.locations.some((l) => normalizeSearch(l.addressLine).includes(term)),
      );
    }

    const offset = query.offset ?? 0;
    return query.limit ? clients.slice(offset, offset + query.limit) : clients.slice(offset);
  }

  async getClientById(id: ClientId): Promise<Client | null> {
    return getDataset().index.clientById.get(id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Pedidos
  // -------------------------------------------------------------------------

  async getOrders(query: OrderQuery = {}): Promise<Order[]> {
    const dataset = getDataset();
    let orders = dataset.orders;

    if (query.clientId) orders = orders.filter((o) => o.clientId === query.clientId);

    if (query.from || query.to) {
      const fromMs = query.from ? new Date(query.from).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = query.to ? new Date(query.to).getTime() : Number.POSITIVE_INFINITY;
      orders = orders.filter((o) => {
        const ms = new Date(o.createdAt).getTime();
        return ms >= fromMs && ms <= toMs;
      });
    }

    const sorted = [...orders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return query.limit ? sorted.slice(0, query.limit) : sorted;
  }

  async getOrderById(id: OrderId): Promise<Order | null> {
    return getDataset().index.orderById.get(id) ?? null;
  }

  async getOrderByNumber(number: string): Promise<Order | null> {
    return getDataset().index.orderByNumber.get(number.trim().toUpperCase()) ?? null;
  }

  // -------------------------------------------------------------------------
  // Ordenes de trabajo y rutas (estado vivo)
  // -------------------------------------------------------------------------

  /**
   * Proyecta el estado real de rutas y OT a partir del simulador.
   *
   * Es el corazon del progreso automatico: las paradas que el vehiculo ya
   * visito pasan a `visita_detectada`, la siguiente a `proxima`, y la entrega
   * se confirma por GPS cuando se cumple la permanencia minima.
   */
  private buildLiveState(): Map<string, LiveRouteState> {
    const dataset = getDataset();
    const settings = getOperationalSettings();
    const now = new Date();
    const result = new Map<string, LiveRouteState>();

    for (const route of dataset.routes) {
      if (!route.vehicleId) continue;

      const visited = new Set(fleetSimulator.getVisitedStopSequences(route.vehicleId));
      const mode = fleetSimulator.getMode(route.vehicleId);
      const history = fleetSimulator.getHistory(
        route.vehicleId,
        new Date(now.getTime() - 8 * 3_600_000),
        now,
      );

      const stops: RouteStop[] = [];
      const workOrders: WorkOrder[] = [];
      let nextAssigned = false;

      // La ruta se considera cerrada cuando todas sus paradas fueron
      // visitadas. Se calcula ANTES de recorrerlas porque decide si una
      // parada visitada queda como evidencia (`visita_detectada`) o como
      // entrega cerrada (`completada`).
      const routeComplete =
        route.stops.length > 0 && route.stops.every((stop) => visited.has(stop.sequence));
      const routeEnded = mode === 'finalizado';

      for (const stop of route.stops) {
        const original = dataset.index.workOrderById.get(stop.workOrderId);
        if (!original) continue;

        const geofence = original.geofenceId
          ? dataset.index.geofenceById.get(original.geofenceId)
          : undefined;

        let status: WorkOrderStatus;
        let arrivalAt: string | null = null;
        let departureAt: string | null = null;
        let confirmation = original.deliveryConfirmation;
        let closest: number | null = null;
        let dwell: number | null = null;

        if (visited.has(stop.sequence)) {
          const visit = geofence
            ? evaluateDeliveryVisit({
                geofence,
                positions: history,
                minDwellSeconds: settings.geofence.minDwellSeconds,
                now,
              })
            : null;

          // Sin evidencia GPS no se inventa una hora de llegada a partir de la
          // planificada: seria presentar un plan como si fuera un hecho.
          arrivalAt = visit?.enteredAt ?? null;
          departureAt = visit?.exitedAt ?? null;
          closest = visit?.closestApproachMeters ?? null;
          dwell = visit ? visit.dwellSeconds : null;

          if (visit?.confirmed) {
            confirmation = settings.geofence.autoConfirmDeliveryOnDwell ? 'gps' : 'none';
            // Mientras el vehiculo sigue dentro, la parada esta en curso. Al
            // cerrarse la ruta completa, la parada pasa de evidencia de visita
            // a entrega cerrada.
            status =
              departureAt === null
                ? 'en_cliente'
                : routeComplete
                  ? 'completada'
                  : 'visita_detectada';
          } else {
            // Paso por la direccion sin permanencia suficiente: la parada
            // avanza, pero NO se declara entrega. La distincion entre
            // evidencia y confirmacion es deliberada.
            status = 'visita_detectada';
          }
        } else if (routeEnded) {
          // La ruta termino sin que el vehiculo llegara a esta direccion.
          // Marcarla como completada seria declarar una entrega que no
          // ocurrio; se reporta como incidencia para que la operacion la vea.
          status = 'incidencia';
        } else if (!nextAssigned) {
          nextAssigned = true;
          status = mode === 'en_parada' ? 'en_cliente' : 'proxima';
        } else {
          status = 'en_ruta';
        }

        stops.push({ ...stop, status, actualArrivalAt: arrivalAt });
        workOrders.push({
          ...original,
          status,
          actualArrivalAt: arrivalAt,
          actualDepartureAt: departureAt,
          deliveryConfirmation: confirmation,
          closestApproachMeters: closest,
          dwellSeconds: dwell,
        });
      }

      result.set(route.id, {
        route: {
          ...route,
          stops,
          status: routeComplete ? 'completada' : 'en_curso',
          executedPath: history.map((p) => ({ lat: p.lat, lng: p.lng })),
          completedAt: routeComplete ? now.toISOString() : null,
        },
        workOrders,
      });
    }

    return result;
  }

  private getAllLiveWorkOrders(): WorkOrder[] {
    const dataset = getDataset();
    const live = this.buildLiveState();
    const overridden = new Map<string, WorkOrder>();

    for (const state of live.values()) {
      for (const workOrder of state.workOrders) overridden.set(workOrder.id, workOrder);
    }

    return dataset.workOrders.map((wo) => overridden.get(wo.id) ?? wo);
  }

  async getWorkOrders(query: WorkOrderQuery = {}): Promise<WorkOrder[]> {
    let workOrders = this.getAllLiveWorkOrders();

    if (query.date) {
      const target = new Date(query.date);
      workOrders = workOrders.filter((w) => isSameDay(new Date(w.scheduledDate), target));
    }

    if (query.from || query.to) {
      const fromMs = query.from ? new Date(query.from).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = query.to ? new Date(query.to).getTime() : Number.POSITIVE_INFINITY;
      workOrders = workOrders.filter((w) => {
        const ms = new Date(w.scheduledDate).getTime();
        return ms >= fromMs && ms <= toMs;
      });
    }

    if (query.vehicleId) workOrders = workOrders.filter((w) => w.vehicleId === query.vehicleId);
    if (query.clientId) workOrders = workOrders.filter((w) => w.clientId === query.clientId);
    if (query.routeId) workOrders = workOrders.filter((w) => w.routeId === query.routeId);

    const sorted = [...workOrders].sort(
      (a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime(),
    );
    return query.limit ? sorted.slice(0, query.limit) : sorted;
  }

  async getWorkOrderById(id: WorkOrderId): Promise<WorkOrder | null> {
    return this.getAllLiveWorkOrders().find((w) => w.id === id) ?? null;
  }

  async getWorkOrderByNumber(number: string): Promise<WorkOrder | null> {
    const term = number.trim().toUpperCase();
    const all = this.getAllLiveWorkOrders();

    // Se acepta tanto el numero de OT como el de pedido: el cliente final rara
    // vez distingue entre ambos.
    return (
      all.find((w) => w.number.toUpperCase() === term) ??
      all.find((w) => w.orderNumber.toUpperCase() === term) ??
      all.find((w) => w.trackingToken?.toUpperCase() === term) ??
      null
    );
  }

  async getRoutes(query: RouteQuery = {}): Promise<Route[]> {
    const live = this.buildLiveState();
    let routes = getDataset().routes.map((r) => live.get(r.id)?.route ?? r);

    if (query.date) {
      const target = new Date(query.date);
      routes = routes.filter((r) => isSameDay(new Date(r.date), target));
    }
    if (query.vehicleId) routes = routes.filter((r) => r.vehicleId === query.vehicleId);

    return query.limit ? routes.slice(0, query.limit) : routes;
  }

  async getRouteById(id: RouteId): Promise<Route | null> {
    return this.buildLiveState().get(id)?.route ?? getDataset().index.routeById.get(id) ?? null;
  }

  // -------------------------------------------------------------------------
  // Flota
  // -------------------------------------------------------------------------

  // Delega en el almacen compartido (memoria sembrada desde el dataset de
  // demostracion, o Supabase si esta configurado) para que un vehiculo dado
  // de alta en tiempo de ejecucion aparezca aqui igual que en el proveedor
  // "external": ambos proveedores sirven la misma flota persistida.
  async getVehicles(): Promise<Vehicle[]> {
    return listVehicles();
  }

  async getDrivers(): Promise<Driver[]> {
    return listDrivers();
  }

  // -------------------------------------------------------------------------
  // Geocercas y visitas
  // -------------------------------------------------------------------------

  async getGeofences(): Promise<Geofence[]> {
    // El almacen es la fuente de verdad: contiene las geocercas sembradas
    // desde la demostracion mas las que haya creado un operador.
    return listGeofences();
  }

  async getGeofenceEvents(limit = 100): Promise<GeofenceEvent[]> {
    const dataset = getDataset();
    const events = fleetSimulator.getEvents(undefined, limit * 3);

    return events
      .filter((e) => e.type === 'geofence_enter' || e.type === 'geofence_exit')
      .map((event) => {
        const geofence = event.geofenceId ? dataset.index.geofenceById.get(event.geofenceId) : undefined;
        const workOrder = geofence
          ? dataset.workOrders.find((w) => w.geofenceId === geofence.id)
          : undefined;

        return {
          id: event.id,
          geofenceId: event.geofenceId!,
          geofenceName: geofence?.name ?? 'Geocerca',
          vehicleId: event.vehicleId,
          workOrderId: workOrder?.id ?? null,
          orderId: workOrder?.orderId ?? null,
          clientId: workOrder?.clientId ?? null,
          type: event.type === 'geofence_enter' ? ('enter' as const) : ('exit' as const),
          timestamp: event.timestamp,
          position: event.position ?? { lat: 0, lng: 0 },
          distanceMeters:
            geofence && event.position
              ? Math.round(haversineMeters(geofenceCenter(geofence), event.position))
              : 0,
        } satisfies GeofenceEvent;
      })
      .filter((e) => e.geofenceId !== undefined)
      .slice(0, limit);
  }

  async getCustomerVisits(limit = 100): Promise<CustomerVisit[]> {
    const dataset = getDataset();
    const settings = getOperationalSettings();
    const now = new Date();
    const visits: CustomerVisit[] = [];

    const live = this.buildLiveState();

    for (const state of live.values()) {
      for (const workOrder of state.workOrders) {
        if (!workOrder.actualArrivalAt || !workOrder.geofenceId) continue;

        const geofence = dataset.index.geofenceById.get(workOrder.geofenceId);
        if (!geofence) continue;

        const dwellSeconds =
          workOrder.dwellSeconds ??
          calculateDwellTime(workOrder.actualArrivalAt, workOrder.actualDepartureAt, now);

        visits.push({
          id: `visit-${workOrder.id}`,
          clientId: workOrder.clientId,
          clientName: workOrder.clientName,
          vehicleId: workOrder.vehicleId!,
          workOrderId: workOrder.id,
          geofenceId: geofence.id,
          enteredAt: workOrder.actualArrivalAt,
          exitedAt: workOrder.actualDepartureAt,
          dwellSeconds,
          closestApproachMeters: workOrder.closestApproachMeters ?? 0,
          entryPosition: geofenceCenter(geofence),
          confirmed: dwellSeconds >= settings.geofence.minDwellSeconds,
        });
      }
    }

    return visits
      .sort((a, b) => new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime())
      .slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Alertas
  // -------------------------------------------------------------------------

  /**
   * Genera las alertas ejecutando los motores de reglas sobre el estado vivo.
   * Cada alerta que aparece en pantalla proviene de una condicion evaluada,
   * no de una lista fija.
   */
  private buildAlerts(): Alert[] {
    const dataset = getDataset();
    const settings = getOperationalSettings();
    const now = new Date();
    const alerts: Alert[] = [];

    const push = (alert: Omit<Alert, 'state' | 'acknowledgedAt' | 'resolvedAt'>): void => {
      const override = alertStateOverrides.get(alert.id);
      alerts.push({
        ...alert,
        state: override?.state ?? 'nueva',
        acknowledgedAt: override?.state === 'revisada' ? override.at : null,
        resolvedAt: override?.state === 'resuelta' ? override.at : null,
      });
    };

    const live = this.buildLiveState();

    // --- Telemetria ---------------------------------------------------------
    for (const vehicle of dataset.vehicles) {
      if (!vehicle.device) continue;

      const lastAt = fleetSimulator.getLastKnownAt(vehicle.id);
      const { state, secondsSinceLastPosition } = evaluateConnectionState(lastAt, settings.gps, now);

      if (state === 'offline' || state === 'lost') {
        push({
          id: asAlertId(`alert-gps-${vehicle.id}`),
          type: state === 'offline' ? 'gps_offline' : 'gps_sin_posicion_reciente',
          category: 'gps',
          severity: state === 'offline' ? 'critical' : 'warning',
          title: state === 'offline' ? 'Vehiculo sin senal GPS' : 'Posible perdida de senal',
          description:
            state === 'offline'
              ? `El equipo de ${vehicle.plate} no reporta posicion hace mas de ${Math.round(settings.gps.offlineSeconds / 60)} minutos.`
              : `${vehicle.plate} lleva ${Math.round((secondsSinceLastPosition ?? 0) / 60)} minutos sin reportar.`,
          timestamp: lastAt ?? now.toISOString(),
          vehicleId: vehicle.id,
          vehiclePlate: vehicle.plate,
          clientId: null,
          clientName: null,
          workOrderId: null,
          workOrderNumber: null,
          position: null,
          metadata: { segundosSinReportar: secondsSinceLastPosition ?? 0 },
        });
      }
    }

    // --- Ruta y comuna ------------------------------------------------------
    for (const { route } of live.values()) {
      if (!route.vehicleId) continue;

      const vehicle = dataset.index.vehicleById.get(route.vehicleId);
      if (!vehicle) continue;

      const history = fleetSimulator.getHistory(
        route.vehicleId,
        new Date(now.getTime() - 3_600_000),
        now,
      );
      if (history.length === 0) continue;

      const deviation = evaluateRouteDeviation({
        positions: history,
        plannedPath: route.plannedPath,
        settings: settings.route,
      });

      if (deviation.deviationConfirmed) {
        const last = history[history.length - 1]!;
        const nextStop = route.stops.find((s) => s.status === 'proxima' || s.status === 'en_cliente');

        push({
          id: asAlertId(`alert-dev-${route.vehicleId}`),
          type: 'ruta_desvio',
          category: 'ruta',
          severity: 'warning',
          title: 'Vehiculo fuera de ruta planificada',
          description: `${vehicle.plate} se encuentra a ${deviation.distanceMeters} m del corredor de la ruta ${route.code} desde hace ${Math.round(deviation.continuousSecondsOutside / 60)} minutos.`,
          timestamp: deviation.deviationStartedAt ?? now.toISOString(),
          vehicleId: vehicle.id,
          vehiclePlate: vehicle.plate,
          clientId: nextStop?.clientId ?? null,
          clientName: nextStop?.clientName ?? null,
          workOrderId: nextStop?.workOrderId ?? null,
          workOrderNumber:
            nextStop ? (dataset.index.workOrderById.get(nextStop.workOrderId)?.number ?? null) : null,
          position: { lat: last.lat, lng: last.lng },
          metadata: {
            distanciaFueraDeRuta: deviation.distanceMeters ?? 0,
            desviacionMaxima: deviation.maxDeviationMeters,
            rutaEsperada: route.code,
          },
        });
      }

      const commune = evaluateCommuneCompliance({
        positions: history,
        communes: [...COMMUNES],
        authorizedCommuneCodes: route.authorizedCommuneCodes,
        toleranceSeconds: settings.route.outOfCommuneToleranceSeconds,
      });

      if (commune.violationConfirmed && commune.currentCommune) {
        const last = history[history.length - 1]!;
        const authorizedNames = route.authorizedCommuneCodes
          .map((code) => COMMUNES.find((c) => c.code === code)?.name ?? code)
          .join(' / ');

        push({
          id: asAlertId(`alert-com-${route.vehicleId}`),
          type: 'ruta_fuera_de_comuna',
          category: 'ruta',
          severity: 'warning',
          title: 'Vehiculo fuera de la zona programada',
          description: `Camion ${vehicle.plate} se encuentra actualmente en ${commune.currentCommune.name} y su ruta programada corresponde al sector ${authorizedNames}.`,
          timestamp: now.toISOString(),
          vehicleId: vehicle.id,
          vehiclePlate: vehicle.plate,
          clientId: null,
          clientName: null,
          workOrderId: null,
          workOrderNumber: null,
          position: { lat: last.lat, lng: last.lng },
          metadata: {
            comunaActual: commune.currentCommune.name,
            comunasAutorizadas: authorizedNames,
            minutosFueraDeZona: Math.round(commune.continuousSecondsOutside / 60),
          },
        });
      }
    }

    // --- Geocerca / entregas detectadas -------------------------------------
    // Las entregas detectadas son informativas y de alta frecuencia. Se acotan
    // a la ventana reciente para que el centro de alertas siga siendo un lugar
    // donde mirar lo que requiere accion, no un registro de actividad.
    const deliveryNoticeWindowMs = 2 * 3_600_000;

    for (const { workOrders } of live.values()) {
      for (const workOrder of workOrders) {
        if (workOrder.deliveryConfirmation !== 'gps' || !workOrder.actualArrivalAt) continue;
        if (now.getTime() - new Date(workOrder.actualArrivalAt).getTime() > deliveryNoticeWindowMs) {
          continue;
        }

        push({
          id: asAlertId(`alert-del-${workOrder.id}`),
          type: 'geocerca_entrega_detectada',
          category: 'geocerca',
          severity: 'info',
          title: 'Entrega detectada por GPS',
          description: `${workOrder.clientName} - permanencia de ${Math.round((workOrder.dwellSeconds ?? 0) / 60)} min a ${workOrder.closestApproachMeters ?? 0} m del domicilio.`,
          timestamp: workOrder.actualArrivalAt,
          vehicleId: workOrder.vehicleId,
          vehiclePlate: workOrder.vehicleId
            ? (dataset.index.vehicleById.get(workOrder.vehicleId)?.plate ?? null)
            : null,
          clientId: workOrder.clientId,
          clientName: workOrder.clientName,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number,
          position: workOrder.coordinates,
          metadata: {
            permanenciaSegundos: workOrder.dwellSeconds ?? 0,
            distanciaMinima: workOrder.closestApproachMeters ?? 0,
          },
        });
      }
    }

    // --- Operacion ----------------------------------------------------------
    const allWorkOrders = this.getAllLiveWorkOrders();
    const today = new Date();

    for (const workOrder of allWorkOrders) {
      if (!isSameDay(new Date(workOrder.scheduledDate), today)) continue;

      if (workOrder.status === 'pendiente' && workOrder.vehicleId === null) {
        push({
          id: asAlertId(`alert-noveh-${workOrder.id}`),
          type: 'ot_sin_camion',
          category: 'operacion',
          severity: 'warning',
          title: 'Orden de trabajo sin camion asignado',
          description: `${workOrder.number} para ${workOrder.clientName} (${workOrder.communeName}) no tiene vehiculo asignado.`,
          timestamp: workOrder.scheduledWindowStart ?? workOrder.scheduledDate,
          vehicleId: null,
          vehiclePlate: null,
          clientId: workOrder.clientId,
          clientName: workOrder.clientName,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number,
          position: workOrder.coordinates,
          metadata: { comuna: workOrder.communeName, prioridad: workOrder.priority },
        });
      }

      if (workOrder.coordinates === null) {
        push({
          id: asAlertId(`alert-nogeo-${workOrder.id}`),
          type: 'pedido_sin_coordenadas',
          category: 'operacion',
          severity: 'warning',
          title: 'Direccion de despacho sin coordenadas',
          description: `${workOrder.number} apunta a "${workOrder.addressLine}, ${workOrder.communeName}" y no puede geocercarse ni mostrarse en el mapa.`,
          timestamp: workOrder.scheduledDate,
          vehicleId: workOrder.vehicleId,
          vehiclePlate: null,
          clientId: workOrder.clientId,
          clientName: workOrder.clientName,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number,
          position: null,
          metadata: { direccion: workOrder.addressLine },
        });
      }

      const windowEnd = workOrder.scheduledWindowEnd ? new Date(workOrder.scheduledWindowEnd) : null;
      const late =
        windowEnd !== null &&
        windowEnd.getTime() < now.getTime() &&
        !['completada', 'visita_detectada', 'cancelada'].includes(workOrder.status);

      if (late) {
        push({
          id: asAlertId(`alert-late-${workOrder.id}`),
          type: 'ot_atrasada',
          category: 'operacion',
          severity: 'warning',
          title: 'Orden de trabajo atrasada',
          description: `${workOrder.number} supero su ventana comprometida sin registrar entrega.`,
          timestamp: workOrder.scheduledWindowEnd!,
          vehicleId: workOrder.vehicleId,
          vehiclePlate: workOrder.vehicleId
            ? (dataset.index.vehicleById.get(workOrder.vehicleId)?.plate ?? null)
            : null,
          clientId: workOrder.clientId,
          clientName: workOrder.clientName,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.number,
          position: workOrder.coordinates,
          metadata: { comuna: workOrder.communeName },
        });
      }
    }

    // --- Clientes -----------------------------------------------------------
    for (const client of dataset.clients) {
      const activity = calculateClientActivityStatus({
        lastPurchaseAt: client.lastPurchaseAt,
        lastVisitAt: client.lastVisitAt,
        thresholds: settings.clients,
        now,
      });

      if (activity.status === 'active') continue;

      const location = client.locations.find((l) => l.isPrimary) ?? client.locations[0] ?? null;
      const crossedRecently =
        activity.effectiveDays !== null &&
        (activity.status === 'warning'
          ? activity.effectiveDays <= settings.clients.activeMaxDays + 3
          : activity.effectiveDays <= settings.clients.warningMaxDays + 3);

      // Solo se alerta el CRUCE de umbral, no el estado permanente: de lo
      // contrario el centro de alertas se llenaria con cientos de clientes
      // dormidos y perderia utilidad.
      if (!crossedRecently) continue;

      push({
        id: asAlertId(`alert-cli-${client.id}`),
        type: activity.status === 'warning' ? 'cliente_pasa_amarillo' : 'cliente_pasa_rojo',
        category: 'cliente',
        severity: activity.status === 'warning' ? 'info' : 'warning',
        title:
          activity.status === 'warning'
            ? 'Cliente pasa a observacion'
            : 'Cliente pasa a estado dormido',
        description: `${client.tradeName} (${client.code}) lleva ${activity.effectiveDays} dias sin comprar.`,
        timestamp: client.lastPurchaseAt ?? now.toISOString(),
        vehicleId: null,
        vehiclePlate: null,
        clientId: client.id,
        clientName: client.tradeName,
        workOrderId: null,
        workOrderNumber: null,
        position: location?.coordinates ?? null,
        metadata: {
          diasSinComprar: activity.effectiveDays ?? 0,
          comuna: location?.communeName ?? 'Sin comuna',
        },
      });
    }

    return alerts.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  async getAlerts(query: AlertQuery = {}): Promise<Alert[]> {
    // Las sinteticas se calculan sobre el mundo de demostracion completo
    // (dataset ficticio); las reales vienen de telemetria en vivo evaluada
    // contra geocercas reales (ver `geofence-detector.ts`). Se combinan para
    // no perder ninguna: un vehiculo conectado por "Conectar GPS" aparece
    // aqui aunque el resto de la flota siga siendo la de demostracion.
    let alerts = [...(await listRealAlerts()), ...this.buildAlerts()];

    if (query.states?.length) {
      const wanted = new Set(query.states);
      alerts = alerts.filter((a) => wanted.has(a.state));
    }

    if (query.from || query.to) {
      const fromMs = query.from ? new Date(query.from).getTime() : Number.NEGATIVE_INFINITY;
      const toMs = query.to ? new Date(query.to).getTime() : Number.POSITIVE_INFINITY;
      alerts = alerts.filter((a) => {
        const ms = new Date(a.timestamp).getTime();
        return ms >= fromMs && ms <= toMs;
      });
    }

    return query.limit ? alerts.slice(0, query.limit) : alerts;
  }

  async updateAlertState(id: AlertId, state: AlertState): Promise<Alert | null> {
    alertStateOverrides.set(id, { state, at: new Date().toISOString() });
    return this.buildAlerts().find((a) => a.id === id) ?? null;
  }
}
