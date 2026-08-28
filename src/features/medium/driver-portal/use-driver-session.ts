'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DriverRouteSession } from '@/types/core';
import {
  dequeueDelivery,
  enqueueDelivery,
  markAttempt,
  readQueue,
  toRequestBody,
  type QueuedDelivery,
  type QueueStorage,
} from './offline-queue';

/**
 * Estado de la jornada en el telefono del conductor.
 *
 * Reune tres cosas que en terreno van siempre juntas: lo que dice el
 * servidor, lo que el conductor ya declaro pero aun no se ha enviado, y si
 * hay cobertura. La interfaz nunca debe mostrar una parada como pendiente
 * cuando el conductor ya la cerro y solo falta que salga de la cola.
 */

export interface SubmitDeliveryInput {
  workOrderId: string;
  outcome: 'entregada' | 'incidencia';
  deliveredLiters: number | null;
  receiverName: string | null;
  receiverDocument: string | null;
  comment: string | null;
  incidentReason: QueuedDelivery['incidentReason'];
  photos: QueuedDelivery['photos'];
  capturedPosition: QueuedDelivery['capturedPosition'];
  capturedAccuracyMeters: number | null;
}

export interface DriverSessionState {
  session: DriverRouteSession | null;
  limits: { maxPhotos: number; maxPhotoBytes: number };
  loading: boolean;
  /** Mensaje para el conductor. `expired` distingue el enlace caducado. */
  error: string | null;
  expired: boolean;
  online: boolean;
  pending: QueuedDelivery[];
  submitting: boolean;
  submitDelivery: (input: SubmitDeliveryInput) => Promise<{ ok: boolean; queued: boolean }>;
  refresh: () => Promise<void>;
  flushQueue: () => Promise<void>;
}

const POLL_MS = 30_000;
const DEFAULT_LIMITS = { maxPhotos: 4, maxPhotoBytes: 900_000 };

function browserStorage(): QueueStorage {
  if (typeof window === 'undefined') {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  return window.localStorage;
}

export function useDriverSession(token: string): DriverSessionState {
  const storage = useMemo(browserStorage, []);
  const [session, setSession] = useState<DriverRouteSession | null>(null);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState<QueuedDelivery[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [online, setOnline] = useState(true);

  // Evita que dos vaciados de cola se solapen (por ejemplo, al recuperar
  // cobertura justo cuando toca el refresco periodico): reintentar en
  // paralelo la misma entrega no la duplica en el servidor, pero si produce
  // errores confusos en pantalla.
  const flushing = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/conductor/ruta/${token}`, { cache: 'no-store' });

      if (response.status === 410) {
        setExpired(true);
        setError('Este enlace caduco. Pide uno nuevo a la central.');
        return;
      }
      if (!response.ok) {
        setError('Enlace no valido. Verifica el mensaje que recibiste.');
        return;
      }

      const data = (await response.json()) as {
        session: DriverRouteSession;
        limits: { maxPhotos: number; maxPhotoBytes: number };
      };
      setSession(data.session);
      setLimits(data.limits);
      setError(null);
    } catch {
      // Sin conexion no se borra lo ya cargado: el conductor sigue viendo su
      // ruta y puede seguir declarando entregas contra la cola.
      setOnline(false);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;

    try {
      for (const delivery of readQueue(storage, token)) {
        try {
          const response = await fetch(
            `/api/conductor/ruta/${token}/paradas/${encodeURIComponent(delivery.workOrderId)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toRequestBody(delivery)),
            },
          );

          // 2xx confirma; 4xx significa que el servidor no la aceptara nunca
          // (parada ajena o datos invalidos) y reintentarla seria un bucle.
          // Solo los fallos de red y los 5xx se reintentan.
          if (response.ok || (response.status >= 400 && response.status < 500)) {
            setPending(dequeueDelivery(storage, token, delivery.workOrderId));
          } else {
            setPending(markAttempt(storage, token, delivery.workOrderId, 'El servidor no respondio.'));
          }
        } catch {
          setPending(markAttempt(storage, token, delivery.workOrderId, 'Sin conexion.'));
        }
      }
      await refresh();
    } finally {
      flushing.current = false;
    }
  }, [refresh, storage, token]);

  const submitDelivery = useCallback(
    async (input: SubmitDeliveryInput) => {
      setSubmitting(true);
      try {
        const queued: QueuedDelivery = {
          id: `${input.workOrderId}-${Date.now()}`,
          ...input,
          declaredAt: new Date().toISOString(),
          attempts: 0,
          lastError: null,
        };

        // Se escribe SIEMPRE en la cola antes de intentar el envio. Si el
        // telefono pierde senal, se apaga o el navegador cierra la pestana a
        // mitad del envio, la declaracion sigue estando.
        setPending(enqueueDelivery(storage, token, queued));
        await flushQueue();

        const remaining = readQueue(storage, token);
        const stillQueued = remaining.some((d) => d.workOrderId === input.workOrderId);
        return { ok: true, queued: stillQueued };
      } finally {
        setSubmitting(false);
      }
    },
    [flushQueue, storage, token],
  );

  useEffect(() => {
    setPending(readQueue(storage, token));
    void refresh();
  }, [refresh, storage, token]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setOnline(window.navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      // Recuperar cobertura es exactamente el momento de vaciar la cola.
      void flushQueue();
    };
    const handleOffline = () => setOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushQueue]);

  useEffect(() => {
    if (expired) return;
    const timer = window.setInterval(() => {
      if (window.navigator.onLine) void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [expired, refresh]);

  return {
    session,
    limits,
    loading,
    error,
    expired,
    online,
    pending,
    submitting,
    submitDelivery,
    refresh,
    flushQueue,
  };
}
