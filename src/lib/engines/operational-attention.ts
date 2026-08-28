import type { AlertsKpis, ClientsKpis, FleetKpis, OrdersKpis, RouteSummary } from '@/types/views';

/**
 * Que requiere atencion AHORA, en orden.
 *
 * Un panel que solo muestra cifras obliga al operador a comparar veintitantos
 * numeros para deducir por donde empezar. Este motor hace esa lectura una vez
 * y la deja explicita: cada elemento dice cuantos son, por que importan y a
 * donde ir a resolverlo.
 *
 * Es una funcion pura: la misma operacion produce siempre la misma lista, y
 * se puede probar sin levantar la interfaz.
 */

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  count: number;
  /** Que ocurre. */
  title: string;
  /** Por que importa, en lenguaje de la operacion. */
  detail: string;
  /** Donde se resuelve. */
  href: string;
  actionLabel: string;
}

export interface AttentionInput {
  fleet: FleetKpis;
  orders: OrdersKpis;
  clients: ClientsKpis;
  alerts: AlertsKpis;
  activeRoutes: RouteSummary[];
  now: Date;
}

/**
 * Margen antes de dar una parada por atrasada.
 *
 * Una ETA se cumple con holgura de minutos, no al segundo. Avisar en cuanto
 * pasa la hora exacta produciria un aviso permanente que nadie mirara.
 */
const LATE_THRESHOLD_MINUTES = 15;

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Paradas cuya ETA ya vencio con holgura. */
export function countLateRoutes(routes: RouteSummary[], now: Date): number {
  const limit = now.getTime() - LATE_THRESHOLD_MINUTES * 60_000;

  return routes.filter((route) => {
    if (route.status !== 'en_curso' || route.nextStopEta === null) return false;
    const eta = Date.parse(route.nextStopEta);
    return Number.isFinite(eta) && eta < limit;
  }).length;
}

export function buildAttentionList(input: AttentionInput): AttentionItem[] {
  const { fleet, orders, clients, alerts, activeRoutes, now } = input;
  const lateRoutes = countLateRoutes(activeRoutes, now);

  const candidates: AttentionItem[] = [
    {
      id: 'alertas-criticas',
      severity: 'critical',
      count: alerts.criticas.value,
      title: 'alertas criticas abiertas',
      detail: 'Requieren decision inmediata del operador.',
      href: '/alertas?severidad=critical',
      actionLabel: 'Revisar alertas',
    },
    {
      id: 'vehiculos-offline',
      severity: 'critical',
      // Un camion cargado de combustible sin señal no es un dato: es un
      // vehiculo del que la operacion no sabe nada.
      count: fleet.offline.value,
      title: 'vehiculos sin señal',
      detail: 'No se conoce su posicion ni su estado de carga.',
      href: '/flota?estado=offline',
      actionLabel: 'Ver flota',
    },
    {
      id: 'ot-incidencia',
      severity: 'warning',
      count: orders.conIncidencia.value,
      title: 'entregas con incidencia',
      detail: 'El conductor no pudo completarlas. Hay que reagendar.',
      href: '/ordenes?estado=incidencia',
      actionLabel: 'Ver ordenes',
    },
    {
      id: 'rutas-atrasadas',
      severity: 'warning',
      count: lateRoutes,
      title: 'rutas con la proxima parada atrasada',
      detail: `Superan en mas de ${LATE_THRESHOLD_MINUTES} minutos la hora estimada.`,
      href: '/rutas',
      actionLabel: 'Ver rutas',
    },
    {
      id: 'alertas-advertencia',
      severity: 'warning',
      count: alerts.advertencias.value,
      title: 'advertencias abiertas',
      detail: 'Desvios, detenciones prolongadas y salidas de comuna.',
      href: '/alertas?severidad=warning',
      actionLabel: 'Revisar alertas',
    },
    {
      id: 'ot-pendientes',
      severity: 'warning',
      count: orders.pendientes.value,
      title: 'despachos sin asignar',
      detail: 'Siguen sin vehiculo asignado para hoy.',
      href: '/ordenes?estado=pendiente',
      actionLabel: 'Asignar',
    },
    {
      id: 'clientes-dormidos',
      severity: 'info',
      count: clients.dormidos.value,
      title: 'clientes dormidos',
      detail: 'Sin compras ni visitas en el plazo configurado.',
      href: '/clientes/dormidos',
      actionLabel: 'Ver cartera',
    },
  ];

  // Solo lo que realmente ocurre. Un panel que enumera ceros entrena al
  // operador a ignorarlo.
  return candidates
    .filter((item) => item.count > 0)
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      return bySeverity !== 0 ? bySeverity : b.count - a.count;
    });
}

/**
 * CUIDADO: los indicadores de despacho SE SOLAPAN.
 *
 *   visitados      = visita_detectada + completada
 *   finalizados    = completada                      <- subconjunto de visitados
 *   proximas       = proxima + en_cliente
 *
 * Sumarlos sin mas cuenta dos veces las ordenes completadas e ignora las que
 * estan en el domicilio. Estas dos funciones son el unico lugar donde esa
 * relacion se resuelve, para que ninguna pantalla tenga que recordarla.
 */

/**
 * Cumplimiento del dia: proporcion de despachos ya resueltos.
 *
 * Resuelto = el vehiculo llego y la parada se cerro, entregada o con
 * incidencia. `visitados` YA incluye a `finalizados`, asi que sumarlos
 * inflaria el porcentaje. Se devuelve `null` sin despachos, en vez de un 0 %
 * o un 100 % que mentirian igual.
 */
export function dayCompletionRatio(orders: OrdersKpis): number | null {
  const total = orders.despachosHoy.value;
  if (total <= 0) return null;

  const resolved = orders.visitados.value + orders.conIncidencia.value;
  return Math.min(1, resolved / total);
}

export interface DispatchStage {
  id: string;
  label: string;
  value: number;
  href: string;
}

/**
 * El dia como tramos EXCLUYENTES, que suman el total de despachos.
 *
 * Cada orden aparece una sola vez. Si los tramos no sumaran el total, la
 * barra representaria una operacion que no existe.
 */
export function dispatchStages(orders: OrdersKpis): DispatchStage[] {
  return [
    {
      id: 'finalizados',
      label: 'Finalizados',
      value: orders.finalizados.value,
      href: '/ordenes?estado=completada',
    },
    {
      id: 'visitados',
      label: 'Visitados',
      // Restando los finalizados, que ya se cuentan en su propio tramo.
      value: Math.max(0, orders.visitados.value - orders.finalizados.value),
      href: '/ordenes?estado=visita_detectada',
    },
    {
      id: 'proximas',
      label: 'Proximas',
      value: orders.proximasEntregas.value,
      href: '/ordenes?estado=proxima',
    },
    {
      id: 'en-ruta',
      label: 'En ruta',
      value: orders.enRuta.value,
      href: '/ordenes?estado=en_ruta',
    },
    {
      id: 'pendientes',
      label: 'Pendientes',
      value: orders.pendientes.value,
      href: '/ordenes?estado=pendiente',
    },
    {
      id: 'incidencia',
      label: 'Incidencias',
      value: orders.conIncidencia.value,
      href: '/ordenes?estado=incidencia',
    },
  ];
}
