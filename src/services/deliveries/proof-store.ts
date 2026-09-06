import 'server-only';

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getServerEnv } from '@/config/env';
import { haversineMeters } from '@/lib/geo';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import type {
  DeliveryProof,
  DeliveryProofOutcome,
  LatLng,
  ProofPhoto,
  RouteId,
  WorkOrderId,
} from '@/types/core';

/**
 * Evidencia de entrega levantada en terreno.
 *
 * Vive en el almacenamiento interno de la plataforma. La base de Fenice es de
 * SOLO LECTURA: aqui no se escribe nada sobre ella.
 *
 * Persistencia: Supabase (`evidencias_entrega` + `fotos_evidencia`) cuando
 * esta configurado; si no, memoria del proceso, igual que antes. Las fotos se
 * guardan como `bytea` en Supabase (no como texto base64): pesan un tercio
 * menos y no obligan a Postgres a tratarlas como texto indexable.
 */

const EVIDENCE_TABLE = 'evidencias_entrega';
const PHOTO_TABLE = 'fotos_evidencia';

const globalForProofs = globalThis as unknown as {
  __feniceDeliveryProofs?: Map<WorkOrderId, DeliveryProof>;
};

function memoryStore(): Map<WorkOrderId, DeliveryProof> {
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

function validatePhotoLimits(photos: DeliveryProofInput['photos']): string | null {
  const limits = getProofLimits();

  if (photos.length > limits.maxPhotos) {
    return `Se admiten hasta ${limits.maxPhotos} fotografias por parada.`;
  }

  for (const photo of photos) {
    if (photo.byteSize > limits.maxPhotoBytes) {
      return `Cada fotografia debe pesar menos de ${Math.round(limits.maxPhotoBytes / 1000)} KB.`;
    }
    // El tamano declarado tiene que corresponderse con lo recibido: si no, el
    // limite anterior se saltaria simplemente mintiendo en `byteSize`.
    const actual = Math.floor((photo.dataUrl.length - photo.dataUrl.indexOf(',') - 1) * 0.75);
    if (actual > limits.maxPhotoBytes) {
      return 'La fotografia recibida supera el tamano permitido.';
    }
  }
  return null;
}

function buildProof(
  input: DeliveryProofInput,
  context: RecordProofContext,
  now: Date,
): DeliveryProof {
  const position = input.capturedPosition ?? null;

  return {
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
}

// ---------------------------------------------------------------------------
// Backend Supabase: fotos como bytea, no como texto base64
// ---------------------------------------------------------------------------

function dataUrlToBytea(dataUrl: string): { hex: string; mime: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Formato de imagen invalido.');
  const [, mime, base64] = match as unknown as [string, string, string];
  // PostgREST espera (y devuelve) bytea como texto hexadecimal con prefijo
  // `\x`, que es el formato de salida por defecto de Postgres para bytea.
  return { mime, hex: `\\x${Buffer.from(base64, 'base64').toString('hex')}` };
}

function byteaToDataUrl(hexValue: string, mime: string): string {
  const hex = hexValue.startsWith('\\x') ? hexValue.slice(2) : hexValue;
  return `data:${mime};base64,${Buffer.from(hex, 'hex').toString('base64')}`;
}

interface EvidenceRow {
  id: string;
  orden_trabajo_id: string;
  ruta_id: string;
  conductor_id: string | null;
  vehiculo_id: string | null;
  resultado: DeliveryProofOutcome;
  litros_entregados: number | null;
  receptor_nombre: string | null;
  receptor_documento: string | null;
  comentario: string | null;
  motivo_incidencia: DeliveryProof['incidentReason'];
  posicion_capturada: LatLng | null;
  precision_captura_metros: number | null;
  distancia_a_cliente_metros: number | null;
  declarado_at: string;
  recibido_at: string;
  enviado_offline: boolean;
}

interface PhotoRow {
  id: string;
  imagen: string;
  tipo_mime: string;
  ancho: number;
  alto: number;
  peso_bytes: number;
  capturada_at: string;
}

async function rowsToProof(row: EvidenceRow): Promise<DeliveryProof> {
  const { data: photoRows } = await getSupabaseClient()
    .from(PHOTO_TABLE)
    .select('*')
    .eq('evidencia_id', row.id);

  const photos: ProofPhoto[] = ((photoRows as PhotoRow[]) ?? []).map((photo) => ({
    id: photo.id,
    dataUrl: byteaToDataUrl(photo.imagen, photo.tipo_mime),
    byteSize: photo.peso_bytes,
    width: photo.ancho,
    height: photo.alto,
    capturedAt: photo.capturada_at,
  }));

  return {
    id: row.id,
    workOrderId: row.orden_trabajo_id as WorkOrderId,
    routeId: row.ruta_id as RouteId,
    driverId: row.conductor_id as DeliveryProof['driverId'],
    vehicleId: row.vehiculo_id as DeliveryProof['vehicleId'],
    outcome: row.resultado,
    deliveredLiters: row.litros_entregados,
    receiverName: row.receptor_nombre,
    receiverDocument: row.receptor_documento,
    comment: row.comentario,
    incidentReason: row.motivo_incidencia,
    photos,
    capturedPosition: row.posicion_capturada,
    capturedAccuracyMeters: row.precision_captura_metros,
    distanceToClientMeters: row.distancia_a_cliente_metros,
    declaredAt: row.declarado_at,
    receivedAt: row.recibido_at,
    submittedOffline: row.enviado_offline,
  };
}

async function recordInSupabase(
  input: DeliveryProofInput,
  context: RecordProofContext,
  now: Date,
): Promise<RecordProofResult> {
  const supabase = getSupabaseClient();

  const { data: existing } = await supabase
    .from(EVIDENCE_TABLE)
    .select('*')
    .eq('orden_trabajo_id', context.workOrderId)
    .maybeSingle<EvidenceRow>();

  if (existing) {
    return { ok: true, proof: await rowsToProof(existing), duplicate: true };
  }

  const limitError = validatePhotoLimits(input.photos);
  if (limitError) return { ok: false, error: limitError };

  const proof = buildProof(input, context, now);

  const { data: inserted, error } = await supabase
    .from(EVIDENCE_TABLE)
    .insert({
      orden_trabajo_id: proof.workOrderId,
      ruta_id: proof.routeId,
      conductor_id: proof.driverId,
      vehiculo_id: proof.vehicleId,
      resultado: proof.outcome,
      litros_entregados: proof.deliveredLiters,
      receptor_nombre: proof.receiverName,
      receptor_documento: proof.receiverDocument,
      comentario: proof.comment,
      motivo_incidencia: proof.incidentReason,
      posicion_capturada: proof.capturedPosition,
      precision_captura_metros: proof.capturedAccuracyMeters,
      distancia_a_cliente_metros: proof.distanceToClientMeters,
      declarado_at: proof.declaredAt,
      recibido_at: proof.receivedAt,
      enviado_offline: proof.submittedOffline,
    })
    .select('id')
    .single<{ id: string }>();

  if (error || !inserted) {
    // Una carrera entre dos reintentos del mismo telefono pudo perder aqui:
    // se resuelve como duplicado en vez de fallar dos veces.
    if (error?.code === '23505') {
      const { data: raced } = await supabase
        .from(EVIDENCE_TABLE)
        .select('*')
        .eq('orden_trabajo_id', context.workOrderId)
        .maybeSingle<EvidenceRow>();
      if (raced) return { ok: true, proof: await rowsToProof(raced), duplicate: true };
    }
    return { ok: false, error: `No fue posible registrar la evidencia: ${error?.message ?? 'sin respuesta'}` };
  }

  if (proof.photos.length > 0) {
    const photoRows = proof.photos.map((photo) => {
      const { hex, mime } = dataUrlToBytea(photo.dataUrl);
      return {
        id: photo.id,
        evidencia_id: inserted.id,
        imagen: hex,
        tipo_mime: mime,
        ancho: photo.width,
        alto: photo.height,
        peso_bytes: photo.byteSize,
        capturada_at: photo.capturedAt,
      };
    });
    const { error: photoError } = await supabase.from(PHOTO_TABLE).insert(photoRows);
    if (photoError) console.error('[proof-store] no fue posible guardar las fotos:', photoError.message);
  }

  return { ok: true, proof: { ...proof, id: inserted.id }, duplicate: false };
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

/**
 * Registra la evidencia de una parada.
 *
 * Es IDEMPOTENTE por orden de trabajo. El telefono del conductor reintenta al
 * recuperar senal y puede enviar la misma evidencia varias veces; eso no debe
 * producir dos entregas. Si ya hay evidencia, se devuelve la existente marcada
 * como duplicada en vez de sobrescribirla: la primera declaracion es la que
 * vale, y sobrescribirla permitiria reescribir la historia desde el telefono.
 */
export async function recordDeliveryProof(
  input: DeliveryProofInput,
  context: RecordProofContext,
): Promise<RecordProofResult> {
  const now = context.now ?? new Date();

  if (isSupabaseConfigured()) return recordInSupabase(input, context, now);

  const store = memoryStore();
  const existing = store.get(context.workOrderId);
  if (existing) return { ok: true, proof: existing, duplicate: true };

  const limitError = validatePhotoLimits(input.photos);
  if (limitError) return { ok: false, error: limitError };

  const proof = buildProof(input, context, now);
  store.set(context.workOrderId, proof);
  return { ok: true, proof, duplicate: false };
}

export async function getProof(workOrderId: WorkOrderId): Promise<DeliveryProof | null> {
  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseClient()
      .from(EVIDENCE_TABLE)
      .select('*')
      .eq('orden_trabajo_id', workOrderId)
      .maybeSingle<EvidenceRow>();
    return data ? rowsToProof(data) : null;
  }
  return memoryStore().get(workOrderId) ?? null;
}

export async function getProofs(
  workOrderIds: Iterable<WorkOrderId>,
): Promise<Map<WorkOrderId, DeliveryProof>> {
  const ids = [...workOrderIds];
  const result = new Map<WorkOrderId, DeliveryProof>();
  if (ids.length === 0) return result;

  if (isSupabaseConfigured()) {
    const { data } = await getSupabaseClient()
      .from(EVIDENCE_TABLE)
      .select('*')
      .in('orden_trabajo_id', ids);
    for (const row of (data as EvidenceRow[]) ?? []) {
      result.set(row.orden_trabajo_id as WorkOrderId, await rowsToProof(row));
    }
    return result;
  }

  const store = memoryStore();
  for (const id of ids) {
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
export async function listProofs(query: ProofQuery = {}): Promise<DeliveryProof[]> {
  if (isSupabaseConfigured()) {
    let builder = getSupabaseClient().from(EVIDENCE_TABLE).select('*');
    if (query.routeId) builder = builder.eq('ruta_id', query.routeId);
    if (query.outcome) builder = builder.eq('resultado', query.outcome);
    builder = builder.order('declarado_at', { ascending: false });
    if (query.limit) builder = builder.limit(query.limit);

    const { data, error } = await builder;
    if (error) {
      console.error('[proof-store] no fue posible listar evidencias:', error.message);
      return [];
    }
    const proofs = await Promise.all(((data as EvidenceRow[]) ?? []).map(rowsToProof));
    return query.withPhotosOnly ? proofs.filter((p) => p.photos.length > 0) : proofs;
  }

  let proofs = [...memoryStore().values()];
  if (query.routeId) proofs = proofs.filter((p) => p.routeId === query.routeId);
  if (query.outcome) proofs = proofs.filter((p) => p.outcome === query.outcome);
  if (query.withPhotosOnly) proofs = proofs.filter((p) => p.photos.length > 0);

  proofs.sort((a, b) => Date.parse(b.declaredAt) - Date.parse(a.declaredAt));
  return query.limit ? proofs.slice(0, query.limit) : proofs;
}

/** Solo para pruebas y para `demo:purge`. */
export async function clearProofs(): Promise<void> {
  memoryStore().clear();
  if (isSupabaseConfigured()) {
    // Solo se usa en pruebas locales contra un proyecto de desarrollo: nunca
    // en produccion, donde `FLEET_DATA_PROVIDER=supabase` implica datos reales.
    await getSupabaseClient().from(PHOTO_TABLE).delete().neq('id', '');
    await getSupabaseClient().from(EVIDENCE_TABLE).delete().neq('id', '');
  }
}
