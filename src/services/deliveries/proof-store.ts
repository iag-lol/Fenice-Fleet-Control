import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getServerEnv } from '@/config/env';
import { haversineMeters } from '@/lib/geo';
import type {
  DeliveryProof,
  DeliveryProofOutcome,
  LatLng,
  RouteId,
  WorkOrderId,
} from '@/types/core';

/**
 * Evidencia de entrega levantada en terreno.
 *
 * Vive en el almacenamiento interno de la plataforma. La base de Fenice es de
 * SOLO LECTURA: aqui no se escribe nada sobre ella. Cuando exista base propia
 * este modulo cambia su respaldo sin que cambie su interfaz.
 */

const globalForProofs = globalThis as unknown as {
  __feniceDeliveryProofs?: Map<WorkOrderId, DeliveryProof>;
};

function getStore(): Map<WorkOrderId, DeliveryProof> {
  if (!globalForProofs.__feniceDeliveryProofs) {
    globalForProofs.__feniceDeliveryProofs = new Map<WorkOrderId, DeliveryProof>();
  }
  return globalForProofs.__feniceDeliveryProofs;
}

/**
 * Solo se aceptan imagenes en linea. Una URL remota convertiria la galeria de
 * evidencia en un vector para cargar contenido de terceros.
 */
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

const photoSchema = z.object({
  dataUrl: z.string().regex(DATA_URL, 'La fotografia debe venir codificada como imagen.'),
  byteSize: z.number().int().positive(),
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000),
  capturedAt: z.string().datetime({ offset: true }),
});

const INCIDENT_REASONS = [
  'cliente_ausente',
  'sin_acceso',
  'estanque_lleno',
  'rechazo_cliente',
  'documentacion',
  'problema_vehiculo',
  'condiciones_seguridad',
  'direccion_incorrecta',
  'otro',
] as const;

export const deliveryProofInputSchema = z
  .object({
    outcome: z.enum(['entregada', 'incidencia']),
    deliveredLiters: z.number().nonnegative().max(60_000).nullable().optional(),
    receiverName: z.string().trim().min(3).max(120).nullable().optional(),
    receiverDocument: z.string().trim().max(30).nullable().optional(),
    comment: z.string().trim().max(600).nullable().optional(),
    incidentReason: z.enum(INCIDENT_REASONS).nullable().optional(),
    photos: z.array(photoSchema).default([]),
    capturedPosition: z
      .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
      .nullable()
      .optional(),
    capturedAccuracyMeters: z.number().nonnegative().max(10_000).nullable().optional(),
    declaredAt: z.string().datetime({ offset: true }),
    submittedOffline: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    // Una entrega sin quien la recibe no es evidencia de nada.
    if (value.outcome === 'entregada' && !value.receiverName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['receiverName'],
        message: 'Indica quien recibio la entrega.',
      });
    }
    // Una incidencia sin motivo no se puede contar ni corregir.
    if (value.outcome === 'incidencia' && !value.incidentReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['incidentReason'],
        message: 'Indica el motivo de la incidencia.',
      });
    }
  });

export type DeliveryProofInput = z.infer<typeof deliveryProofInputSchema>;

export interface RecordProofContext {
  workOrderId: WorkOrderId;
  routeId: RouteId;
  driverId: DeliveryProof['driverId'];
  vehicleId: DeliveryProof['vehicleId'];
  /** Domicilio declarado del cliente, para contrastar donde se firmo. */
  clientCoordinates: LatLng | null;
  now?: Date;
}

export type RecordProofResult =
  | { ok: true; proof: DeliveryProof; duplicate: boolean }
  | { ok: false; error: string };

/** Limites de carga util, para que el cliente los respete antes de subir. */
export function getProofLimits(): { maxPhotos: number; maxPhotoBytes: number } {
  const env = getServerEnv();
  return { maxPhotos: env.PROOF_MAX_PHOTOS, maxPhotoBytes: env.PROOF_PHOTO_MAX_BYTES };
}

/**
 * Registra la evidencia de una parada.
 *
 * Es IDEMPOTENTE por orden de trabajo. El telefono del conductor reintenta al
 * recuperar senal y puede enviar la misma evidencia varias veces; eso no debe
 * producir dos entregas. Si ya hay evidencia, se devuelve la existente marcada
 * como duplicada en vez de sobrescribirla: la primera declaracion es la que
 * vale, y sobrescribirla permitiria reescribir la historia desde el telefono.
 */
export function recordDeliveryProof(
  input: DeliveryProofInput,
  context: RecordProofContext,
): RecordProofResult {
  const store = getStore();
  const existing = store.get(context.workOrderId);
  if (existing) return { ok: true, proof: existing, duplicate: true };

  const limits = getProofLimits();

  if (input.photos.length > limits.maxPhotos) {
    return { ok: false, error: `Se admiten hasta ${limits.maxPhotos} fotografias por parada.` };
  }

  for (const photo of input.photos) {
    if (photo.byteSize > limits.maxPhotoBytes) {
      return {
        ok: false,
        error: `Cada fotografia debe pesar menos de ${Math.round(limits.maxPhotoBytes / 1000)} KB.`,
      };
    }
    // El tamano declarado tiene que corresponderse con lo recibido: si no, el
    // limite anterior se saltaria simplemente mintiendo en `byteSize`.
    const actual = Math.floor((photo.dataUrl.length - photo.dataUrl.indexOf(',') - 1) * 0.75);
    if (actual > limits.maxPhotoBytes) {
      return { ok: false, error: 'La fotografia recibida supera el tamano permitido.' };
    }
  }

  const now = context.now ?? new Date();
  const position = input.capturedPosition ?? null;

  const proof: DeliveryProof = {
    id: randomUUID(),
    workOrderId: context.workOrderId,
    routeId: context.routeId,
    driverId: context.driverId,
    vehicleId: context.vehicleId,
    outcome: input.outcome as DeliveryProofOutcome,
    deliveredLiters: input.deliveredLiters ?? null,
    receiverName: input.receiverName ?? null,
    receiverDocument: input.receiverDocument ?? null,
    comment: input.comment ?? null,
    incidentReason: input.incidentReason ?? null,
    photos: input.photos.map((photo) => ({ id: randomUUID(), ...photo })),
    capturedPosition: position,
    capturedAccuracyMeters: input.capturedAccuracyMeters ?? null,
    distanceToClientMeters:
      position && context.clientCoordinates
        ? Math.round(haversineMeters(position, context.clientCoordinates))
        : null,
    declaredAt: input.declaredAt,
    receivedAt: now.toISOString(),
    submittedOffline: input.submittedOffline,
  };

  store.set(context.workOrderId, proof);
  return { ok: true, proof, duplicate: false };
}

export function getProof(workOrderId: WorkOrderId): DeliveryProof | null {
  return getStore().get(workOrderId) ?? null;
}

export function getProofs(workOrderIds: Iterable<WorkOrderId>): Map<WorkOrderId, DeliveryProof> {
  const store = getStore();
  const result = new Map<WorkOrderId, DeliveryProof>();
  for (const id of workOrderIds) {
    const proof = store.get(id);
    if (proof) result.set(id, proof);
  }
  return result;
}

export interface ProofQuery {
  routeId?: RouteId;
  outcome?: DeliveryProofOutcome;
  withPhotosOnly?: boolean;
  limit?: number;
}

/** Listado para la galeria de administracion, mas reciente primero. */
export function listProofs(query: ProofQuery = {}): DeliveryProof[] {
  let proofs = [...getStore().values()];

  if (query.routeId) proofs = proofs.filter((p) => p.routeId === query.routeId);
  if (query.outcome) proofs = proofs.filter((p) => p.outcome === query.outcome);
  if (query.withPhotosOnly) proofs = proofs.filter((p) => p.photos.length > 0);

  proofs.sort((a, b) => Date.parse(b.declaredAt) - Date.parse(a.declaredAt));
  return query.limit ? proofs.slice(0, query.limit) : proofs;
}

/** Solo para pruebas y para `demo:purge`. */
export function clearProofs(): void {
  getStore().clear();
}
