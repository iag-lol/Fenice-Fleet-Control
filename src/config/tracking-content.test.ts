import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACKING_CONTENT,
  EXAMPLE_TRACKING_SLIDES,
  publicTrackingContent,
  trackingContentSchema,
  trackingImageType,
} from './tracking-content';

const content = {
  ...DEFAULT_TRACKING_CONTENT,
  enabled: true,
  slides: EXAMPLE_TRACKING_SLIDES,
};
describe('publicidad del seguimiento', () => {
  it('solo publica imágenes activas y oculta todas al desactivar publicidad', () => {
    expect(
      publicTrackingContent({
        ...content,
        slides: content.slides.map((slide, index) => ({
          ...slide,
          enabled: index === 0,
        })),
      }).slides,
    ).toHaveLength(1);
    expect(
      publicTrackingContent({ ...content, enabled: false }).slides,
    ).toEqual([]);
  });
  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,bad',
    'http://ads.example/x.png',
    '//ads.example/x.png',
    'https://user:pass@example.com/image.png',
    '/api/seguimiento/imagenes/../../content.json',
  ])(
    'rechaza imágenes o enlaces que pueden ejecutar código o filtrar credenciales: %s',
    (url) => {
      expect(
        trackingContentSchema.safeParse({
          ...content,
          slides: [{ ...content.slides[0], imageUrl: url }],
        }).success,
      ).toBe(false);
      expect(
        trackingContentSchema.safeParse({
          ...content,
          slides: [{ ...content.slides[0], linkUrl: url }],
        }).success,
      ).toBe(false);
    },
  );
  it('permite HTTPS y archivos propios sin abrir rutas arbitrarias del servidor', () => {
    expect(
      trackingContentSchema.safeParse({
        ...content,
        slides: [
          {
            ...content.slides[0],
            imageUrl: 'https://example.com/ad.webp',
            linkUrl: 'https://fenice.cl',
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      trackingContentSchema.safeParse({
        ...content,
        slides: [
          {
            ...content.slides[0],
            imageUrl:
              '/api/seguimiento/imagenes/148e0f5c-4e1e-4ea1-894f-a1bb47c5c5f4.webp',
          },
        ],
      }).success,
    ).toBe(true);
  });
  it('limita frecuencia, cantidad e identificadores duplicados', () => {
    expect(
      trackingContentSchema.safeParse({ ...content, intervalSeconds: 1 })
        .success,
    ).toBe(false);
    expect(
      trackingContentSchema.safeParse({
        ...content,
        slides: Array.from({ length: 7 }, (_, i) => ({
          ...content.slides[0],
          id: `s${i}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      trackingContentSchema.safeParse({
        ...content,
        slides: [content.slides[0], content.slides[0]],
      }).success,
    ).toBe(false);
  });
  it('comprueba firmas de archivo y no acepta SVG o HTML subidos como imagen', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    expect(trackingImageType(png)?.mime).toBe('image/png');
    expect(
      trackingImageType(new Uint8Array([255, 216, 255, ...Array(9).fill(0)]))
        ?.mime,
    ).toBe('image/jpeg');
    expect(
      trackingImageType(new TextEncoder().encode('RIFF1234WEBPmore'))?.mime,
    ).toBe('image/webp');
    expect(
      trackingImageType(
        new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
      ),
    ).toBeNull();
    expect(
      trackingImageType(new TextEncoder().encode('<html>not an image</html>')),
    ).toBeNull();
  });
});
