'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { HttpGpsProvider } from '@/services/gps/client/http-gps-provider';
import type { GpsTransport } from '@/services/gps/gps-provider';
import type { Position } from '@/types/core';
import type { LivePositionsPayload } from '@/types/views';

/**
 * Telemetria viva de la flota, compartida por toda la aplicacion.
 *
 * UNA sola suscripcion por pestana, sin importar cuantos componentes la
 * consuman. Esto NO es una optimizacion opcional: el encabezado, la pagina
 * activa y las fichas abiertas consumen telemetria a la vez, y si cada uno
 * abriera su propio stream se agotaria el limite de conexiones simultaneas
 * por origen del navegador (6 en HTTP/1.1). El sintoma es peor que el
 * consumo: la navegacion se cuelga porque no quedan conexiones libres.
 *
 * Se implementa como almacen externo con conteo de referencias en lugar de un
 * contexto de React para que funcione desde cualquier punto del arbol,
 * incluido el seguimiento publico, que no usa el shell interno.
 */

export interface LiveFleetSnapshot {
  positions: Map<string, Position>;
  transport: GpsTransport;
  /** Falla vigente de telemetria. La UI degrada, no se cae. */
  error: string | null;
  /** Ultimo instante con datos validos. */
  lastUpdateAt: string | null;
}

const EMPTY_SNAPSHOT: LiveFleetSnapshot = {
  positions: new Map(),
  transport: 'disconnected',
  error: null,
  lastUpdateAt: null,
};

/** Margen antes de cerrar el stream al quedarse sin consumidores. */
const TEARDOWN_GRACE_MS = 4000;

let snapshot: LiveFleetSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<() => void>();
let subscriberCount = 0;
let unsubscribeProvider: (() => void) | null = null;
let teardownTimer: ReturnType<typeof setTimeout> | null = null;

const provider = new HttpGpsProvider();

function emit(next: LiveFleetSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

/**
 * Transporte declarado por el servidor.
 *
 * Se consulta una sola vez por sesion. Mientras llega, la pantalla ya tiene
 * datos: la instantanea inicial viene de `/api/gps/positions`, que se pide en
 * paralelo. Por eso esperar aqui no deja el mapa en blanco.
 */
let transportResolved = false;

async function resolveTransport(): Promise<void> {
  if (transportResolved) return;
  transportResolved = true;

  try {
    const response = await fetch('/api/system/mode', { cache: 'no-store' });
    if (!response.ok) return;

    const mode = (await response.json()) as {
      liveTransport?: string;
      refreshIntervalMs?: number;
    };

    // Solo `polling` obliga. Con `auto` se mantiene el intento de SSE y su
    // degradacion automatica, que es lo que corresponde en un servidor propio.
    if (mode.liveTransport === 'polling') provider.setPreferredTransport('polling');
    if (typeof mode.refreshIntervalMs === 'number') {
      provider.setPollingInterval(mode.refreshIntervalMs);
    }
  } catch {
    // Sin respuesta se mantiene el comportamiento por defecto (SSE con
    // degradacion automatica): no se deja al usuario sin posiciones por no
    // haber podido leer una preferencia.
  }
}

function startStream(): void {
  if (unsubscribeProvider) return;

  // Se resuelve el transporte ANTES de suscribirse. Abrir un stream que el
  // despliegue no soporta produce una reconexion perpetua que ademas consume
  // ejecuciones de funcion.
  if (!transportResolved) {
    void resolveTransport().then(() => {
      // Puede que el ultimo consumidor se haya ido mientras tanto.
      if (subscriberCount > 0 && !unsubscribeProvider) startStream();
    });
    return;
  }

  unsubscribeProvider = provider.subscribeToPositions({
    onPositions: (incoming) => {
      if (incoming.length === 0) return;

      const positions = new Map(snapshot.positions);
      for (const position of incoming) positions.set(position.vehicleId, position);

      emit({
        positions,
        transport: snapshot.transport,
        error: null,
        lastUpdateAt: new Date().toISOString(),
      });
    },
    onError: (error) => {
      emit({ ...snapshot, error: error.message });
    },
    onTransportChange: (transport) => {
      emit({ ...snapshot, transport });
    },
  });
}

function stopStream(): void {
  unsubscribeProvider?.();
  unsubscribeProvider = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  subscriberCount += 1;

  if (teardownTimer !== null) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
  if (subscriberCount === 1) startStream();

  return () => {
    listeners.delete(listener);
    subscriberCount -= 1;

    if (subscriberCount > 0) return;

    // Margen deliberado: durante una navegacion la pagina saliente se
    // desmonta antes de que monte la entrante. Cerrar de inmediato provocaria
    // reconectar el stream en cada cambio de pagina.
    teardownTimer = setTimeout(() => {
      teardownTimer = null;
      if (subscriberCount === 0) stopStream();
    }, TEARDOWN_GRACE_MS);
  };
}

function getSnapshot(): LiveFleetSnapshot {
  return snapshot;
}

/** En el servidor no hay telemetria viva: se entrega el estado vacio. */
function getServerSnapshot(): LiveFleetSnapshot {
  return EMPTY_SNAPSHOT;
}

export interface LiveFleetState extends LiveFleetSnapshot {
  /** Instantanea de flota (conductor, estado, alertas) que acompana a las posiciones. */
  payload: LivePositionsPayload | null;
  isPaused: boolean;
  refresh: () => void;
}

export function useLiveFleet(): LiveFleetState {
  const live = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Metadatos de flota. React Query deduplica por clave, de modo que varios
  // consumidores comparten una unica peticion.
  const { data: payload, refetch } = useQuery({
    queryKey: ['gps', 'positions'],
    staleTime: 20_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<LivePositionsPayload> => {
      const response = await fetch('/api/gps/positions', { cache: 'no-store' });
      if (!response.ok) throw new Error('No fue posible obtener el estado de la flota.');
      return (await response.json()) as LivePositionsPayload;
    },
  });

  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    ...live,
    payload: payload ?? null,
    isPaused: payload?.simulator?.paused ?? false,
    refresh,
  };
}

/**
 * Antiguedad en segundos de una marca de tiempo, refrescada cada segundo.
 *
 * Vive fuera del almacen compartido a proposito: solo re-renderiza a los
 * componentes que muestran el contador, no a toda la aplicacion.
 */
export function useSecondsSince(iso: string | null): number | null {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [iso]);

  return useMemo(() => {
    void tick;
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.round((Date.now() - ms) / 1000));
  }, [iso, tick]);
}
