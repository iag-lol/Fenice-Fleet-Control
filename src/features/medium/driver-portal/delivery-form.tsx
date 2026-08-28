'use client';

import { Camera, Loader2, MapPin, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import type { DeliveryIncidentReason, DriverStop } from '@/types/core';
import { capturePosition, compressPhoto, type CapturedPhoto } from './photo-capture';
import type { SubmitDeliveryInput } from './use-driver-session';

/**
 * Cierre de una parada.
 *
 * Pensado para una sola mano, de pie junto al camion y con guantes: campos
 * grandes, opciones en botones en vez de listas desplegables, y ninguna
 * decision que se pueda posponer. La foto y la posicion son opcionales
 * porque la cobertura y el permiso de ubicacion fallan en terreno, y una
 * entrega real no puede quedar bloqueada por eso.
 */

const INCIDENT_LABEL: Record<DeliveryIncidentReason, string> = {
  cliente_ausente: 'Cliente ausente',
  sin_acceso: 'Sin acceso al lugar',
  estanque_lleno: 'Estanque lleno',
  rechazo_cliente: 'Cliente rechaza',
  documentacion: 'Problema de documentacion',
  problema_vehiculo: 'Problema del vehiculo',
  condiciones_seguridad: 'Condiciones de seguridad',
  direccion_incorrecta: 'Direccion incorrecta',
  otro: 'Otro motivo',
};

export interface DeliveryFormProps {
  stop: DriverStop;
  limits: { maxPhotos: number; maxPhotoBytes: number };
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: SubmitDeliveryInput) => Promise<{ ok: boolean; queued: boolean }>;
}

export function DeliveryForm({ stop, limits, submitting, onCancel, onSubmit }: DeliveryFormProps) {
  const [outcome, setOutcome] = useState<'entregada' | 'incidencia'>('entregada');
  const [liters, setLiters] = useState<string>(String(stop.totalLiters || ''));
  const [receiverName, setReceiverName] = useState('');
  const [receiverDocument, setReceiverDocument] = useState('');
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState<DeliveryIncidentReason | null>(null);
  const [photos, setPhotos] = useState<CapturedPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  // Con el formulario abierto se bloquea el desplazamiento de la lista que
  // queda detras. Sin esto, al llegar al final del formulario el gesto
  // continua moviendo la ruta de fondo y el conductor pierde el contexto.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const addPhotos = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setProcessing(true);
      setPhotoError(null);

      try {
        const room = limits.maxPhotos - photos.length;
        const selected = [...files].slice(0, Math.max(0, room));
        const compressed: CapturedPhoto[] = [];

        for (const file of selected) {
          try {
            compressed.push(await compressPhoto(file, limits.maxPhotoBytes));
          } catch (error) {
            setPhotoError(error instanceof Error ? error.message : 'No pudimos procesar la foto.');
          }
        }

        if (compressed.length > 0) setPhotos((current) => [...current, ...compressed]);
        if (files.length > room) {
          setPhotoError(`Solo se pueden adjuntar ${limits.maxPhotos} fotografias.`);
        }
      } finally {
        setProcessing(false);
        if (fileInput.current) fileInput.current.value = '';
      }
    },
    [limits.maxPhotoBytes, limits.maxPhotos, photos.length],
  );

  const handleSubmit = useCallback(async () => {
    setFormError(null);

    if (outcome === 'entregada' && receiverName.trim().length < 3) {
      setFormError('Indica el nombre de quien recibe.');
      return;
    }
    if (outcome === 'incidencia' && reason === null) {
      setFormError('Selecciona el motivo de la incidencia.');
      return;
    }

    setProcessing(true);
    // La ubicacion se pide al cerrar y no al abrir: pedirla antes gastaria
    // bateria en cada parada que el conductor solo consulta.
    const position = await capturePosition();
    setProcessing(false);

    const parsedLiters = Number.parseFloat(liters.replace(',', '.'));

    await onSubmit({
      workOrderId: stop.workOrderId,
      outcome,
      deliveredLiters:
        outcome === 'entregada' && Number.isFinite(parsedLiters) ? parsedLiters : null,
      receiverName: outcome === 'entregada' ? receiverName.trim() : null,
      receiverDocument: receiverDocument.trim() || null,
      comment: comment.trim() || null,
      incidentReason: outcome === 'incidencia' ? reason : null,
      photos: photos.map(({ dataUrl, byteSize, width, height, capturedAt }) => ({
        dataUrl,
        byteSize,
        width,
        height,
        capturedAt,
      })),
      capturedPosition: position.coordinates,
      capturedAccuracyMeters: position.accuracyMeters,
    });
  }, [comment, liters, onSubmit, outcome, photos, reason, receiverDocument, receiverName, stop.workOrderId]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-950">
      <header className="flex items-center justify-between border-b border-line bg-surface-900 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold text-ink">{stop.clientName}</p>
          <p className="truncate text-xs text-ink-faint">
            Parada {stop.sequence} · {stop.workOrderNumber}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cerrar"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-800"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setOutcome('entregada')}
            className={`flex h-14 items-center justify-center rounded-lg border text-[15px] font-semibold transition-colors ${
              outcome === 'entregada'
                ? 'border-status-active bg-status-active text-white'
                : 'border-line-strong bg-surface-900 text-ink-muted'
            }`}
          >
            Entregado
          </button>
          <button
            type="button"
            onClick={() => setOutcome('incidencia')}
            className={`flex h-14 items-center justify-center rounded-lg border text-[15px] font-semibold transition-colors ${
              outcome === 'incidencia'
                ? 'border-status-dormant bg-status-dormant text-white'
                : 'border-line-strong bg-surface-900 text-ink-muted'
            }`}
          >
            No entregado
          </button>
        </div>

        {outcome === 'entregada' ? (
          <>
            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Litros descargados
              </span>
              <input
                value={liters}
                onChange={(event) => setLiters(event.target.value)}
                inputMode="decimal"
                className="mt-1 h-14 w-full rounded-lg border border-line-strong bg-surface-900 px-3 text-[17px] font-semibold text-ink"
              />
              <span className="mt-1 block text-xs text-ink-faint">
                Comprometidos: {formatNumber(stop.totalLiters)} L
              </span>
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                Quien recibe
              </span>
              <input
                value={receiverName}
                onChange={(event) => setReceiverName(event.target.value)}
                autoComplete="name"
                placeholder="Nombre y apellido"
                className="mt-1 h-14 w-full rounded-lg border border-line-strong bg-surface-900 px-3 text-[17px] text-ink"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                RUT o documento (opcional)
              </span>
              <input
                value={receiverDocument}
                onChange={(event) => setReceiverDocument(event.target.value)}
                className="mt-1 h-14 w-full rounded-lg border border-line-strong bg-surface-900 px-3 text-[17px] text-ink"
              />
            </label>
          </>
        ) : (
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Motivo
            </span>
            <div className="mt-2 grid gap-2">
              {(Object.keys(INCIDENT_LABEL) as DeliveryIncidentReason[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReason(key)}
                  className={`flex h-12 items-center rounded-lg border px-3 text-left text-sm transition-colors ${
                    reason === key
                      ? 'border-brand-500 bg-brand-500/10 font-semibold text-ink'
                      : 'border-line-strong bg-surface-900 text-ink-muted'
                  }`}
                >
                  {INCIDENT_LABEL[key]}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Fotografias ({photos.length}/{limits.maxPhotos})
          </span>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div key={photo.dataUrl.slice(-24)} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.dataUrl}
                  alt={`Evidencia ${index + 1}`}
                  className="h-24 w-full rounded-lg border border-line object-cover"
                />
                <button
                  type="button"
                  aria-label={`Quitar fotografia ${index + 1}`}
                  onClick={() => setPhotos((current) => current.filter((p) => p !== photo))}
                  className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-ink/75 text-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {photos.length < limits.maxPhotos ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong bg-surface-900 text-xs text-ink-faint"
              >
                <Camera className="h-6 w-6" />
                Agregar
              </button>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            // `capture` abre la camara directamente en el telefono; en un
            // equipo de escritorio el navegador lo ignora y abre el selector.
            capture="environment"
            multiple
            className="sr-only"
            onChange={(event) => void addPhotos(event.target.files)}
          />
          {photoError ? <p className="mt-2 text-xs text-status-dormant">{photoError}</p> : null}
        </div>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            Comentario (opcional)
          </span>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            maxLength={600}
            className="mt-1 w-full rounded-lg border border-line-strong bg-surface-900 p-3 text-[15px] text-ink"
          />
        </label>

        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-faint">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          Al confirmar se registra la ubicacion del telefono junto con la entrega.
        </p>
      </div>

      <div className="shrink-0 border-t border-line bg-surface-900 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        {formError ? (
          <p className="mb-2 text-center text-sm font-medium text-status-dormant">{formError}</p>
        ) : null}
        <Button
          block
          size="lg"
          variant={outcome === 'entregada' ? 'primary' : 'danger'}
          onClick={() => void handleSubmit()}
          disabled={submitting || processing}
          className="h-14 text-[16px]"
        >
          {submitting || processing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Guardando
            </>
          ) : outcome === 'entregada' ? (
            'Confirmar entrega'
          ) : (
            'Registrar incidencia'
          )}
        </Button>
      </div>
    </div>
  );
}
