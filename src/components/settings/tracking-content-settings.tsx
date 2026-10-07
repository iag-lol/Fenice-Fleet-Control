'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  ImagePlus,
  Plus,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Button, LinkButton } from '@/components/ui/button';
import { Input, Toggle } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  EXAMPLE_TRACKING_SLIDES,
  MAX_TRACKING_IMAGES,
  MAX_TRACKING_IMAGE_BYTES,
  trackingContentSchema,
  type TrackingContent,
  type TrackingSlide,
} from '@/config/tracking-content';
import { TrackingCampaignCarousel } from '@/components/tracking/tracking-campaign-carousel';

export function TrackingContentSettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TrackingContent | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['settings', 'tracking-content'],
    queryFn: async (): Promise<TrackingContent> => {
      const response = await fetch('/api/configuracion/seguimiento');
      if (!response.ok) throw new Error('No pudimos cargar la publicidad.');
      return response.json();
    },
  });
  useEffect(() => {
    if (data && draft === null) setDraft(data);
  }, [data, draft]);
  const save = useMutation({
    mutationFn: async (content: TrackingContent): Promise<TrackingContent> => {
      const response = await fetch('/api/configuracion/seguimiento', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? 'No se guardaron los cambios.');
      }
      return response.json();
    },
    onSuccess: (content) => {
      setDraft(content);
      queryClient.setQueryData(['settings', 'tracking-content'], content);
      void queryClient.invalidateQueries({ queryKey: ['tracking-content'] });
    },
  });
  const update = (id: string, patch: Partial<TrackingSlide>) =>
    setDraft((value) =>
      value
        ? {
            ...value,
            slides: value.slides.map((slide) =>
              slide.id === id ? { ...slide, ...patch } : slide,
            ),
          }
        : value,
    );
  const add = (imageUrl = '', title = '') =>
    setDraft((value) =>
      value && value.slides.length < MAX_TRACKING_IMAGES
        ? {
            ...value,
            slides: [
              ...value.slides,
              {
                id: crypto.randomUUID(),
                title,
                imageUrl,
                linkUrl: '',
                enabled: true,
              },
            ],
          }
        : value,
    );
  const move = (id: string, direction: number) =>
    setDraft((value) => {
      if (!value) return value;
      const slides = [...value.slides];
      const from = slides.findIndex((slide) => slide.id === id);
      const to = from + direction;
      if (to < 0 || to >= slides.length) return value;
      [slides[from], slides[to]] = [slides[to]!, slides[from]!];
      return { ...value, slides };
    });
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !draft || draft.slides.length >= MAX_TRACKING_IMAGES) return;
    if (
      file.size > MAX_TRACKING_IMAGE_BYTES ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    ) {
      setUploadError('Usa JPG, PNG o WebP de hasta 2 MB.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.set('image', file);
      const response = await fetch('/api/configuracion/seguimiento/imagenes', {
        method: 'POST',
        body: form,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? 'No pudimos subir la imagen.');
      add(
        body.imageUrl,
        file.name
          .replace(/\.[^.]+$/, '')
          .replaceAll('-', ' ')
          .slice(0, 80),
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'No pudimos subir la imagen.',
      );
    } finally {
      setUploading(false);
    }
  };
  const parsed = draft ? trackingContentSchema.safeParse(draft) : null;
  const valid = parsed?.success ?? false;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(data);

  return (
    <Card id="publicidad-seguimiento">
      <CardHeader
        title="Vista del cliente · Publicidad"
        description="Imágenes discretas en el seguimiento público. Sin ventanas ni publicidad sobre el mapa."
        action={
          <LinkButton
            href="/seguimiento"
            size="sm"
            variant="secondary"
            icon={<ExternalLink size={14} />}
          >
            Ver portal
          </LinkButton>
        }
      />
      <CardBody>
        {isLoading ? (
          <Skeleton className="h-40" />
        ) : isError ? (
          <QueryError
            title="No se pudo cargar la publicidad"
            onRetry={() => void refetch()}
          />
        ) : draft ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Toggle
                  checked={draft.enabled}
                  onChange={(enabled) => setDraft({ ...draft, enabled })}
                  label="Mostrar publicidad en el seguimiento"
                />
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  Rotación cada
                  <select
                    aria-label="Intervalo de rotación"
                    value={draft.intervalSeconds}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        intervalSeconds: Number(event.target.value),
                      })
                    }
                    className="rounded-md border border-line bg-surface-900 px-2 py-2 text-xs text-ink"
                  >
                    {[5, 8, 10, 15, 20, 30].map((seconds) => (
                      <option value={seconds} key={seconds}>
                        {seconds} s
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs font-medium text-ink-muted ${uploading || draft.slides.length >= MAX_TRACKING_IMAGES ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-800'}`}
                >
                  <Upload size={14} />
                  {uploading ? 'Subiendo imagen…' : 'Subir imagen'}
                  <input
                    aria-label="Subir imagen de publicidad"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => void upload(event)}
                    disabled={
                      uploading || draft.slides.length >= MAX_TRACKING_IMAGES
                    }
                    className="sr-only"
                  />
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Plus size={14} />}
                  disabled={
                    uploading || draft.slides.length >= MAX_TRACKING_IMAGES
                  }
                  onClick={() => add()}
                >
                  Usar URL de imagen
                </Button>
                {!draft.slides.length ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<ImagePlus size={14} />}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        enabled: true,
                        slides: EXAMPLE_TRACKING_SLIDES.map((slide) => ({
                          ...slide,
                        })),
                      })
                    }
                  >
                    Cargar diseños de ejemplo
                  </Button>
                ) : null}
              </div>
              <p className="text-[11px] text-ink-faint">
                Hasta 6 imágenes. JPG, PNG o WebP · máximo 2 MB cada una.
                Recomendado: formato horizontal 1600 × 800 px. La imagen se
                muestra completa.
              </p>
              {uploadError ? (
                <p role="alert" className="text-xs text-red-700">
                  {uploadError}
                </p>
              ) : null}
              <div className="space-y-3">
                {draft.slides.map((slide, index) => (
                  <div
                    key={slide.id}
                    className="rounded-xl border border-line bg-surface-950 p-3"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink">
                        Imagen {index + 1}
                      </span>
                      <div className="flex items-center gap-1">
                        <Toggle
                          checked={slide.enabled}
                          onChange={(enabled) => update(slide.id, { enabled })}
                          label="Activa"
                        />
                        <button
                          type="button"
                          aria-label={`Subir imagen ${index + 1} en el orden`}
                          onClick={() => move(slide.id, -1)}
                          disabled={index === 0}
                          className="ml-2 rounded p-2 text-ink-muted disabled:opacity-25"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar imagen ${index + 1} en el orden`}
                          onClick={() => move(slide.id, 1)}
                          disabled={index === draft.slides.length - 1}
                          className="rounded p-2 text-ink-muted disabled:opacity-25"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Quitar imagen ${index + 1} de la publicidad`}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              slides: draft.slides.filter(
                                (item) => item.id !== slide.id,
                              ),
                            })
                          }
                          className="rounded p-2 text-ink-faint hover:text-red-700"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1 text-[11px] text-ink-muted">
                        <span>Título / texto alternativo</span>
                        <Input
                          aria-label={`Título de imagen ${index + 1}`}
                          value={slide.title}
                          maxLength={80}
                          onChange={(event) =>
                            update(slide.id, { title: event.target.value })
                          }
                          placeholder="Describe la publicidad"
                        />
                      </label>
                      <label className="space-y-1 text-[11px] text-ink-muted">
                        <span>Enlace al hacer clic (opcional)</span>
                        <Input
                          aria-label={`Enlace de imagen ${index + 1}`}
                          value={slide.linkUrl}
                          maxLength={2000}
                          onChange={(event) =>
                            update(slide.id, { linkUrl: event.target.value })
                          }
                          placeholder="https://tu-sitio.cl"
                        />
                      </label>
                      <label className="space-y-1 text-[11px] text-ink-muted sm:col-span-2">
                        <span>Dirección de la imagen</span>
                        <Input
                          aria-label={`URL de imagen ${index + 1}`}
                          value={slide.imageUrl}
                          maxLength={2000}
                          onChange={(event) =>
                            update(slide.id, { imageUrl: event.target.value })
                          }
                          placeholder="https://… o sube una imagen"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
              {!valid && parsed && !parsed.success ? (
                <p role="alert" className="text-xs text-amber-700">
                  {parsed.error.issues[0]?.message}
                </p>
              ) : null}
              {save.isError ? (
                <p role="alert" className="text-xs text-red-700">
                  {save.error.message}
                </p>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-ink-faint">
                  El cliente solo verá las imágenes activas, en este orden.
                </p>
                <Button
                  size="sm"
                  icon={
                    save.isSuccess && !dirty ? (
                      <Check size={14} />
                    ) : (
                      <Save size={14} />
                    )
                  }
                  onClick={() => save.mutate(draft)}
                  disabled={!dirty || !valid || uploading}
                  loading={save.isPending}
                >
                  {save.isSuccess && !dirty
                    ? 'Publicidad guardada'
                    : 'Guardar publicidad'}
                </Button>
              </div>
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Vista previa
              </p>
              <div className="flex h-[260px] flex-col">
                {valid && parsed?.success ? (
                  <TrackingCampaignCarousel content={parsed.data} />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-line bg-surface-950 px-6 text-center text-xs text-ink-faint">
                    Completa una dirección válida y un título para previsualizar
                    la imagen.
                  </div>
                )}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                La rotación se pausa al pasar el cursor, al usar los controles o
                si el dispositivo solicita menos movimiento. Puedes pausarla
                manualmente.
              </p>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
