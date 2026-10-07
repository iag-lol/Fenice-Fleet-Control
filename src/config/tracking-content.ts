import { z } from 'zod';

export const MAX_TRACKING_IMAGES = 6;
export const MAX_TRACKING_IMAGE_BYTES = 2 * 1024 * 1024;
export const TRACKING_IMAGE_ID = /^[a-f0-9-]{36}\.(?:png|jpg|webp)$/;

function safeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const trackingSlideSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().trim().min(1, 'Escribe un título para la imagen.').max(80),
  imageUrl: z
    .string()
    .max(2000)
    .refine(
      (value) =>
        safeHttpsUrl(value) ||
        /^\/tracking\/[a-z0-9-]+\.(?:svg|png|jpg|webp)$/.test(value) ||
        (value.startsWith('/api/seguimiento/imagenes/') &&
          TRACKING_IMAGE_ID.test(
            value.slice('/api/seguimiento/imagenes/'.length),
          )),
      'Usa una imagen subida o una dirección HTTPS.',
    ),
  linkUrl: z
    .string()
    .max(2000)
    .refine(
      (value) => value === '' || safeHttpsUrl(value),
      'El enlace debe comenzar con https://.',
    )
    .default(''),
  enabled: z.boolean().default(true),
});
export const trackingContentSchema = z
  .object({
    enabled: z.boolean(),
    intervalSeconds: z.number().int().min(5).max(30),
    slides: z.array(trackingSlideSchema).max(MAX_TRACKING_IMAGES),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.slides.map((slide) => slide.id)).size !==
      value.slides.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slides'],
        message: 'Las imágenes deben tener identificadores distintos.',
      });
  });
export type TrackingContent = z.infer<typeof trackingContentSchema>;
export type TrackingSlide = z.infer<typeof trackingSlideSchema>;
export const DEFAULT_TRACKING_CONTENT: TrackingContent = {
  enabled: false,
  intervalSeconds: 8,
  slides: [],
};
export const EXAMPLE_TRACKING_SLIDES: TrackingSlide[] = [
  {
    id: 'fenice-service',
    title: 'Contigo en cada kilómetro',
    imageUrl: '/tracking/campaign-service.svg',
    linkUrl: '',
    enabled: true,
  },
  {
    id: 'fenice-location',
    title: 'Tu entrega, siempre a la vista',
    imageUrl: '/tracking/campaign-location.svg',
    linkUrl: '',
    enabled: true,
  },
];

/** Solo se publican campañas que el administrador ha activado. */
export function publicTrackingContent(
  content: TrackingContent,
): TrackingContent {
  return {
    ...content,
    slides: content.enabled
      ? content.slides.filter((slide) => slide.enabled)
      : [],
  };
}

/** Verifica la firma, no solo la extensión o el MIME declarado por el navegador. */
export function trackingImageType(
  bytes: Uint8Array,
): { mime: string; extension: string } | null {
  if (bytes.length < 12) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v))
    return { mime: 'image/png', extension: 'png' };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { mime: 'image/jpeg', extension: 'jpg' };
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return { mime: 'image/webp', extension: 'webp' };
  return null;
}
