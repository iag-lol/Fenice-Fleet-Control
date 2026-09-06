import 'server-only';

import { getProof, getProofs } from '@/services/deliveries/proof-store';
import type {
  Route,
  RouteStop,
  WorkOrder,
  WorkOrderId,
  WorkOrderStatus,
} from '@/types/core';
import type { ExternalOperationsProvider } from './operations-provider';

/**
 * Superpone lo que el conductor declaro en terreno sobre lo que dice la
 * fuente operacional.
 *
 * Existe por dos razones:
 *
 *  1. La base de Fenice es de SOLO LECTURA. La declaracion del conductor es
 *     un artefacto de esta plataforma y no puede escribirse alli, pero si
 *     debe verse reflejada en toda la aplicacion.
 *  2. La declaracion humana tiene prioridad sobre la inferencia. Si el GPS
 *     no alcanzo a confirmar la permanencia pero el conductor firmo la
 *     entrega, la entrega ocurrio. Y si el conductor reporto una incidencia,
 *     la parada NO esta entregada aunque el camion estuviera dentro.
 *
 * Se implementa como decorador del proveedor y no dentro de una
 * implementacion concreta para que valga igual con datos de demostracion y
 * con la base real: la regla es del dominio, no del origen de los datos.
 */

async function applyProof(workOrder: WorkOrder): Promise<WorkOrder> {
  const proof = await getProof(workOrder.id);
  if (!proof) return workOrder;

  // Una parada cancelada no se reabre por una declaracion posterior.
  if (workOrder.status === 'cancelada') return workOrder;

  const status: WorkOrderStatus = proof.outcome === 'entregada' ? 'completada' : 'incidencia';

  return {
    ...workOrder,
    status,
    // La hora que vale es la que el conductor declaro en terreno; si el GPS
    // ya habia registrado la llegada, esa evidencia es anterior y se conserva.
    actualArrivalAt: workOrder.actualArrivalAt ?? (proof.outcome === 'entregada' ? proof.declaredAt : null),
    deliveryConfirmation: proof.outcome === 'entregada' ? 'driver' : workOrder.deliveryConfirmation,
    notes: proof.comment ?? workOrder.notes,
  };
}

async function applyProofToStops(stops: RouteStop[]): Promise<RouteStop[]> {
  const proofs = await getProofs(stops.map((stop) => stop.workOrderId));
  if (proofs.size === 0) return stops;

  return stops.map((stop) => {
    const proof = proofs.get(stop.workOrderId);
    if (!proof || stop.status === 'cancelada') return stop;

    return {
      ...stop,
      status: proof.outcome === 'entregada' ? 'completada' : 'incidencia',
      actualArrivalAt:
        stop.actualArrivalAt ?? (proof.outcome === 'entregada' ? proof.declaredAt : null),
    } satisfies RouteStop;
  });
}

async function applyProofToRoute(route: Route): Promise<Route> {
  return { ...route, stops: await applyProofToStops(route.stops) };
}

/**
 * Envuelve un proveedor conservando su contrato.
 *
 * Solo se intervienen las lecturas de ordenes de trabajo y rutas: el resto
 * pasa sin tocarse, delegando en el proveedor envuelto.
 */
export function withDriverDeclarations(
  provider: ExternalOperationsProvider,
): ExternalOperationsProvider {
  return new Proxy(provider, {
    get(target, property, receiver) {
      switch (property) {
        case 'getWorkOrders':
          return async (...args: Parameters<ExternalOperationsProvider['getWorkOrders']>) =>
            Promise.all((await target.getWorkOrders(...args)).map(applyProof));

        case 'getWorkOrderById':
          return async (id: WorkOrderId) => {
            const workOrder = await target.getWorkOrderById(id);
            return workOrder ? applyProof(workOrder) : null;
          };

        case 'getWorkOrderByNumber':
          return async (number: string) => {
            const workOrder = await target.getWorkOrderByNumber(number);
            return workOrder ? applyProof(workOrder) : null;
          };

        case 'getRoutes':
          return async (...args: Parameters<ExternalOperationsProvider['getRoutes']>) =>
            Promise.all((await target.getRoutes(...args)).map(applyProofToRoute));

        case 'getRouteById':
          return async (...args: Parameters<ExternalOperationsProvider['getRouteById']>) => {
            const route = await target.getRouteById(...args);
            return route ? applyProofToRoute(route) : null;
          };

        default: {
          const value = Reflect.get(target, property, receiver);
          // Los metodos no interceptados se devuelven ligados al proveedor
          // real: de otro modo perderian su `this` al llamarse desde el Proxy.
          return typeof value === 'function' ? value.bind(target) : value;
        }
      }
    },
  });
}
