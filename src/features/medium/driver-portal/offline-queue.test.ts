import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearQueue,
  dequeueDelivery,
  enqueueDelivery,
  markAttempt,
  queueKey,
  readQueue,
  toRequestBody,
  type QueuedDelivery,
  type QueueStorage,
} from './offline-queue';

function memoryStorage(): QueueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function delivery(overrides: Partial<QueuedDelivery> = {}): QueuedDelivery {
  return {
    id: 'local-1',
    workOrderId: 'wo-1',
    outcome: 'entregada',
    deliveredLiters: 5000,
    receiverName: 'Patricia Soto',
    receiverDocument: null,
    comment: null,
    incidentReason: null,
    photos: [],
    capturedPosition: null,
    capturedAccuracyMeters: null,
    declaredAt: '2026-08-27T14:00:00.000Z',
    attempts: 0,
    lastError: null,
    ...overrides,
  };
}

const TOKEN = 'v1.aaa.bbb.ccc.ddd';

describe('cola sin conexion del conductor', () => {
  let storage: ReturnType<typeof memoryStorage>;
  beforeEach(() => {
    storage = memoryStorage();
  });

  it('no escribe el enlace en claro en el almacenamiento', () => {
    // El enlace es la credencial: no debe quedar legible en el telefono.
    expect(queueKey(TOKEN)).not.toContain(TOKEN);
    expect(queueKey(TOKEN)).not.toBe(queueKey('v1.otro.token.aqui.zzz'));
  });

  it('separa las colas de dos jornadas distintas en el mismo telefono', () => {
    const OTRO = 'v1.zzz.yyy.xxx.www';
    enqueueDelivery(storage, TOKEN, delivery());
    enqueueDelivery(storage, OTRO, delivery({ workOrderId: 'wo-9' }));

    expect(readQueue(storage, TOKEN).map((d) => d.workOrderId)).toEqual(['wo-1']);
    expect(readQueue(storage, OTRO).map((d) => d.workOrderId)).toEqual(['wo-9']);
  });

  it('reemplaza la declaracion de una parada en vez de duplicarla', () => {
    enqueueDelivery(storage, TOKEN, delivery({ receiverName: 'Primero' }));
    const queue = enqueueDelivery(storage, TOKEN, delivery({ receiverName: 'Segundo' }));

    expect(queue).toHaveLength(1);
    expect(queue[0]?.receiverName).toBe('Segundo');
  });

  it('conserva la declaracion hasta que se confirma su envio', () => {
    enqueueDelivery(storage, TOKEN, delivery());
    markAttempt(storage, TOKEN, 'wo-1', 'Sin conexion');

    const pendiente = readQueue(storage, TOKEN)[0];
    expect(pendiente?.attempts).toBe(1);
    expect(pendiente?.lastError).toBe('Sin conexion');
    // Un intento fallido NO puede borrar lo declarado en terreno.
    expect(readQueue(storage, TOKEN)).toHaveLength(1);

    expect(dequeueDelivery(storage, TOKEN, 'wo-1')).toHaveLength(0);
  });

  it('marca como enviada sin conexion la que ya habia fallado antes', () => {
    expect(toRequestBody(delivery({ attempts: 0 })).submittedOffline).toBe(false);
    expect(toRequestBody(delivery({ attempts: 2 })).submittedOffline).toBe(true);
  });

  it('sobrevive a un almacenamiento corrupto sin lanzar', () => {
    storage.data.set(queueKey(TOKEN), '{no es json');
    expect(readQueue(storage, TOKEN)).toEqual([]);
  });

  it('sigue operando si el almacenamiento rechaza escrituras', () => {
    const lleno: QueueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('QuotaExceededError');
      },
    };

    expect(() => enqueueDelivery(lleno, TOKEN, delivery())).not.toThrow();
    expect(() => clearQueue(lleno, TOKEN)).not.toThrow();
  });
});
