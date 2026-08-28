import 'server-only';

import { getServerEnv } from '@/config/env';
import type { GpsProvider } from '@/services/gps/gps-provider';
import { MockGpsProvider } from '@/services/gps/mock/mock-gps-provider';
import type { ExternalOperationsProvider } from '@/services/operations/operations-provider';
import { MockOperationsProvider } from '@/services/operations/mock/mock-operations-provider';
import { TraccarGpsProvider } from '@/services/gps/traccar/traccar-gps-provider';
import {
  createExternalQueryExecutor,
  DatabaseOperationsProvider,
} from '@/services/operations/database/database-operations-provider';
import { withDriverDeclarations } from '@/services/operations/driver-declaration-overlay';

/**
 * Registro de proveedores.
 *
 * Es el UNICO lugar donde se decide que implementacion concreta se usa. El
 * resto del sistema depende de las interfaces `GpsProvider` y
 * `ExternalOperationsProvider`, nunca de una clase concreta.
 *
 * Cambiar de fuente = cambiar una variable de entorno.
 */

const globalForProviders = globalThis as unknown as {
  __feniceGpsProvider?: GpsProvider;
  __feniceOperationsProvider?: ExternalOperationsProvider;
};

function createGpsProvider(): GpsProvider {
  const env = getServerEnv();

  // Los constructores de los proveedores reales validan sus credenciales al
  // instanciarse, no al importarse: en modo demostracion nunca se ejecutan.
  if (env.GPS_PROVIDER === 'traccar') {
    return new TraccarGpsProvider();
  }

  return new MockGpsProvider();
}

function createOperationsProvider(): ExternalOperationsProvider {
  const env = getServerEnv();

  const source =
    env.OPERATIONS_PROVIDER === 'external'
      ? new DatabaseOperationsProvider(createExternalQueryExecutor())
      : new MockOperationsProvider();

  // Lo declarado por el conductor en terreno se superpone a lo que dice la
  // fuente. Se aplica aqui, una sola vez, para que ninguna pantalla pueda
  // olvidarse de considerarlo.
  return withDriverDeclarations(source);
}

export function getGpsProvider(): GpsProvider {
  if (!globalForProviders.__feniceGpsProvider) {
    globalForProviders.__feniceGpsProvider = createGpsProvider();
  }
  return globalForProviders.__feniceGpsProvider;
}

export function getOperationsProvider(): ExternalOperationsProvider {
  if (!globalForProviders.__feniceOperationsProvider) {
    globalForProviders.__feniceOperationsProvider = createOperationsProvider();
  }
  return globalForProviders.__feniceOperationsProvider;
}

/** Resumen de configuracion seguro para exponer al navegador. */
export interface SystemModeInfo {
  authEnabled: boolean;
  gps: { provider: string; label: string; simulated: boolean; transport: string };
  operations: { provider: string; label: string; simulated: boolean; readOnly: boolean };
  routingProvider: string;
  geocodingProvider: string;
  refreshIntervalMs: number;
  /**
   * Transporte que el DESPLIEGUE admite para las posiciones en vivo.
   *
   * Es distinto de `gps.transport`, que es el que prefiere el proveedor. Un
   * proveedor puede preferir polling y el despliegue admitir streaming, o al
   * reves. Solo `polling` obliga al navegador; `auto` deja que intente SSE y
   * degrade solo, que es lo correcto en un servidor propio.
   */
  liveTransport: 'auto' | 'sse' | 'polling';
}

/**
 * Nunca incluir aqui URLs internas, usuarios ni tokens: este objeto viaja al
 * navegador para alimentar el indicador de modo del header.
 */
export function getSystemMode(): SystemModeInfo {
  const env = getServerEnv();
  const gps = getGpsProvider();
  const operations = getOperationsProvider();

  return {
    authEnabled: env.AUTH_ENABLED,
    gps: {
      provider: gps.info.id,
      label: gps.info.label,
      simulated: gps.info.simulated,
      transport: gps.info.preferredTransport,
    },
    operations: {
      provider: operations.info.id,
      label: operations.info.label,
      simulated: operations.info.simulated,
      readOnly: operations.info.readOnly,
    },
    liveTransport: env.GPS_LIVE_TRANSPORT,
    routingProvider: env.ROUTING_PROVIDER,
    geocodingProvider: env.GEOCODING_PROVIDER,
    refreshIntervalMs: env.GPS_REFRESH_INTERVAL_MS,
  };
}
