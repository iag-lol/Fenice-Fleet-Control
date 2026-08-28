import type { DeliveryIncidentReason, ProofPhoto } from '@/types/core';

/**
 * Cola de entregas pendientes de enviar.
 *
 * En terreno la senal se cae: patios cerrados, subterraneos, zonas rurales.
 * El conductor no puede quedarse esperando cobertura con el cliente delante,
 * y una entrega declarada JAMAS debe perderse porque el envio fallo.
 *
 * Por eso lo declarado se escribe primero en el almacenamiento del telefono y
 * se envia despues. El envio se reintenta solo; el servidor es idempotente por
 * orden de trabajo, asi que reintentar no puede duplicar una entrega.
 *
 * La cola se guarda por token de ruta: dos conductores en el mismo telefono
 * (cambio de turno) no mezclan sus jornadas.
 */

export interface QueuedDelivery {
  /** Identificador local. Permite eliminarla de la cola tras confirmarse. */
  id: string;
  workOrderId: string;
  outcome: 'entregada' | 'incidencia';
  deliveredLiters: number | null;
  receiverName: string | null;
  receiverDocument: string | null;
  comment: string | null;
  incidentReason: DeliveryIncidentReason | null;
  photos: Omit<ProofPhoto, 'id'>[];
  capturedPosition: { lat: number; lng: number } | null;
  capturedAccuracyMeters: number | null;
  declaredAt: string;
  attempts: number;
  lastError: string | null;
}

export interface QueueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = 'fenice.conductor.cola.';

/**
 * La clave usa un resumen del token, no el token entero: el enlace es la
 * credencial del conductor y no tiene por que quedar escrito en claro dentro
 * del almacenamiento del navegador.
 */
export function queueKey(token: string): string {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${PREFIX}${(hash >>> 0).toString(36)}`;
}

export function readQueue(storage: QueueStorage, token: string): QueuedDelivery[] {
  try {
    const raw = storage.getItem(queueKey(token));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedDelivery[]) : [];
  } catch {
    // Un almacenamiento corrupto no puede dejar al conductor sin poder
    // trabajar: se empieza de cero en vez de propagar el fallo.
    return [];
  }
}

export function writeQueue(storage: QueueStorage, token: string, queue: QueuedDelivery[]): void {
  try {
    storage.setItem(queueKey(token), JSON.stringify(queue));
  } catch {
    // Cuota agotada: se prefiere seguir operando a bloquear la pantalla. El
    // envio en curso sigue su camino; lo que se pierde es la persistencia
    // entre recargas, y eso se avisa en la interfaz.
  }
}

/**
 * Encola una declaracion.
 *
 * Si ya hay una para la misma parada se REEMPLAZA en lugar de anadirse: dos
 * entradas para la misma orden solo pueden producir un reintento inutil.
 */
export function enqueueDelivery(
  storage: QueueStorage,
  token: string,
  delivery: QueuedDelivery,
): QueuedDelivery[] {
  const queue = readQueue(storage, token).filter((d) => d.workOrderId !== delivery.workOrderId);
  queue.push(delivery);
  writeQueue(storage, token, queue);
  return queue;
}

export function dequeueDelivery(
  storage: QueueStorage,
  token: string,
  workOrderId: string,
): QueuedDelivery[] {
  const queue = readQueue(storage, token).filter((d) => d.workOrderId !== workOrderId);
  writeQueue(storage, token, queue);
  return queue;
}

export function markAttempt(
  storage: QueueStorage,
  token: string,
  workOrderId: string,
  error: string | null,
): QueuedDelivery[] {
  const queue = readQueue(storage, token).map((delivery) =>
    delivery.workOrderId === workOrderId
      ? { ...delivery, attempts: delivery.attempts + 1, lastError: error }
      : delivery,
  );
  writeQueue(storage, token, queue);
  return queue;
}

export function clearQueue(storage: QueueStorage, token: string): void {
  try {
    storage.removeItem(queueKey(token));
  } catch {
    // Sin almacenamiento no hay nada que limpiar.
  }
}

/** Cuerpo que espera el endpoint de cierre de parada. */
export function toRequestBody(delivery: QueuedDelivery): Record<string, unknown> {
  return {
    outcome: delivery.outcome,
    deliveredLiters: delivery.deliveredLiters,
    receiverName: delivery.receiverName,
    receiverDocument: delivery.receiverDocument,
    comment: delivery.comment,
    incidentReason: delivery.incidentReason,
    photos: delivery.photos,
    capturedPosition: delivery.capturedPosition,
    capturedAccuracyMeters: delivery.capturedAccuracyMeters,
    declaredAt: delivery.declaredAt,
    // Marca que llego desde la cola: la administracion distingue una entrega
    // declarada con cobertura de una recuperada mas tarde.
    submittedOffline: delivery.attempts > 0,
  };
}
