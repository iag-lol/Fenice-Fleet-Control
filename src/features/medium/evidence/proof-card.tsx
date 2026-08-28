'use client';

import { AlertTriangle, CheckCircle2, CloudOff, MapPin, User } from 'lucide-react';
import { useState } from 'react';

import { formatDistance, formatNumber, formatSmartDateTime } from '@/lib/format';
import type { DeliveryIncidentReason, DeliveryProof } from '@/types/core';

/**
 * Evidencia de una parada, tal como la ve la operacion.
 *
 * Muestra siempre el ORIGEN y las dos horas: la que declaro el conductor en
 * terreno y la que registro el servidor. Cuando difieren es porque la
 * declaracion viajo en la cola sin conexion, y esa diferencia es justamente
 * lo que hay que poder ver al revisar un reclamo.
 */

export const INCIDENT_LABEL: Record<DeliveryIncidentReason, string> = {
  cliente_ausente: 'Cliente ausente',
  sin_acceso: 'Sin acceso al lugar',
  estanque_lleno: 'Estanque lleno',
  rechazo_cliente: 'Cliente rechaza la entrega',
  documentacion: 'Problema de documentacion',
  problema_vehiculo: 'Problema del vehiculo',
  condiciones_seguridad: 'Condiciones de seguridad',
  direccion_incorrecta: 'Direccion incorrecta',
  otro: 'Otro motivo',
};

/** Distancia a partir de la cual la firma merece revision. */
const REVIEW_DISTANCE_METERS = 250;

export function ProofCard({ proof }: { proof: DeliveryProof }) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  const entregada = proof.outcome === 'entregada';
  const lejos =
    proof.distanceToClientMeters !== null &&
    proof.distanceToClientMeters > REVIEW_DISTANCE_METERS;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {entregada ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-active/12 px-2 py-0.5 text-2xs font-semibold text-status-active">
            <CheckCircle2 className="h-3 w-3" /> Entregada por el conductor
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-dormant/12 px-2 py-0.5 text-2xs font-semibold text-status-dormant">
            <AlertTriangle className="h-3 w-3" />
            {proof.incidentReason ? INCIDENT_LABEL[proof.incidentReason] : 'Incidencia'}
          </span>
        )}
        {proof.submittedOffline ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/12 px-2 py-0.5 text-2xs font-semibold text-status-warning">
            <CloudOff className="h-3 w-3" /> Recibida sin conexion
          </span>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
        {entregada ? (
          <>
            <div>
              <dt className="text-2xs uppercase tracking-wider text-ink-faint">Recibe</dt>
              <dd className="flex items-center gap-1.5 text-ink">
                <User className="h-3.5 w-3.5 text-ink-faint" />
                {proof.receiverName ?? 'Sin registrar'}
                {proof.receiverDocument ? ` · ${proof.receiverDocument}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-2xs uppercase tracking-wider text-ink-faint">Litros descargados</dt>
              <dd className="numeric text-ink">
                {proof.deliveredLiters === null ? 'No declarados' : `${formatNumber(proof.deliveredLiters)} L`}
              </dd>
            </div>
          </>
        ) : null}

        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Declarada en terreno</dt>
          <dd className="numeric text-ink">{formatSmartDateTime(proof.declaredAt)}</dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Recibida por el sistema</dt>
          <dd className="numeric text-ink-muted">{formatSmartDateTime(proof.receivedAt)}</dd>
        </div>

        <div className="col-span-2">
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Posicion al firmar</dt>
          <dd className="flex flex-wrap items-center gap-1.5 text-ink-muted">
            <MapPin className={`h-3.5 w-3.5 ${lejos ? 'text-status-warning' : 'text-ink-faint'}`} />
            {proof.capturedPosition === null ? (
              'El telefono no entrego ubicacion'
            ) : (
              <>
                <span className={lejos ? 'font-semibold text-status-warning' : ''}>
                  a {formatDistance(proof.distanceToClientMeters)} del domicilio
                </span>
                {proof.capturedAccuracyMeters !== null ? (
                  <span className="text-ink-faint">
                    (precision {formatDistance(proof.capturedAccuracyMeters)})
                  </span>
                ) : null}
              </>
            )}
          </dd>
        </div>
      </dl>

      {proof.comment ? (
        <p className="rounded-md border border-line bg-surface-800 px-3 py-2 text-[13px] leading-relaxed text-ink-muted">
          {proof.comment}
        </p>
      ) : null}

      {proof.photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {proof.photos.map((photo, index) =>
            photo.dataUrl ? (
              <button
                key={photo.id}
                type="button"
                onClick={() => setZoomed(photo.dataUrl)}
                className="overflow-hidden rounded-md border border-line"
                aria-label={`Ampliar fotografia ${index + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.dataUrl}
                  alt={`Evidencia ${index + 1}`}
                  className="h-24 w-full object-cover"
                  loading="lazy"
                />
              </button>
            ) : (
              <div
                key={photo.id}
                className="flex h-24 items-center justify-center rounded-md border border-dashed border-line text-2xs text-ink-faint"
              >
                {photo.width}×{photo.height}
              </div>
            ),
          )}
        </div>
      ) : null}

      {zoomed ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Fotografia de la entrega"
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          onClick={() => setZoomed(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomed} alt="Evidencia ampliada" className="max-h-full max-w-full rounded-lg" />
        </div>
      ) : null}
    </div>
  );
}
