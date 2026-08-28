import 'server-only';

import { buildDataset, type DemoDataset } from '@/demo/dataset';

/**
 * Puerta unica al dataset de demostracion.
 *
 * Ningun modulo importa `@/demo/dataset` directamente: todo pasa por aqui,
 * que es donde se aplica el interruptor `DEMO_MODE`. Asi, apagar la
 * demostracion es una sola operacion y no queda informacion ficticia suelta
 * en ningun rincon de la aplicacion.
 *
 * El flujo siempre es:
 *
 *     Interfaz
 *       ↓
 *     Provider (contrato)
 *       ↓
 *     MockProvider  /  RealProvider
 *       ↓
 *     este modulo   /  fuente real
 */

const TRUE_VALUES = new Set(['true', '1', 'yes', 'si']);

/** `true` cuando la plataforma debe servir el dataset de demostracion. */
export function isDemoMode(): boolean {
  const raw = process.env.DEMO_MODE ?? process.env.NEXT_PUBLIC_DEMO_MODE;
  // Por defecto activo: sin fuentes reales conectadas, una plataforma vacia
  // no permitiria validar nada con Fenice.
  if (raw === undefined || raw.trim() === '') return true;
  return TRUE_VALUES.has(raw.trim().toLowerCase());
}

/** Dataset vacio devuelto cuando la demostracion esta apagada. */
const EMPTY_DATASET: DemoDataset = {
  generatedAt: new Date(0).toISOString(),
  seed: 0,
  communes: [],
  drivers: [],
  vehicles: [],
  clients: [],
  orders: [],
  workOrders: [],
  routes: [],
  geofences: [],
  index: {
    clientById: new Map(),
    orderById: new Map(),
    orderByNumber: new Map(),
    workOrderById: new Map(),
    workOrderByNumber: new Map(),
    routeById: new Map(),
    vehicleById: new Map(),
    driverById: new Map(),
    geofenceById: new Map(),
    locationById: new Map(),
  },
};

let cached: DemoDataset | null = null;

/**
 * Dataset de demostracion vigente.
 *
 * Con `DEMO_MODE=false` devuelve un mundo vacio en lugar de datos ficticios:
 * es preferible una pantalla vacia y honesta a una llena de camiones que no
 * existen. Los estados vacios de la interfaz explican que ocurre.
 */
export function getDemoDataset(): DemoDataset {
  if (!isDemoMode()) return EMPTY_DATASET;
  if (!cached) cached = buildDataset();
  return cached;
}

/** Descarta la instancia cacheada. Usado por el comando de reinicio. */
export function resetDemoDataset(): void {
  cached = null;
}

export type { DemoDataset };
