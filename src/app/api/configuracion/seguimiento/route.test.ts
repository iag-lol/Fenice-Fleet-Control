import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('@/lib/api', async () => ({
  ...(await vi.importActual('@/lib/api')),
  guardApi: mocks.guard,
}));
vi.mock('@/services/tracking/content-store', () => ({
  getTrackingContent: mocks.get,
  saveTrackingContent: mocks.save,
  saveTrackingImage: mocks.upload,
}));
import { GET, PUT } from './route';
import { POST } from './imagenes/route';
import { DEFAULT_TRACKING_CONTENT } from '@/config/tracking-content';
const put = (body: unknown, origin = 'http://localhost') =>
  PUT(
    new Request('http://localhost/api/configuracion/seguimiento', {
      method: 'PUT',
      headers: {
        Host: 'localhost',
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(null);
  mocks.get.mockResolvedValue(DEFAULT_TRACKING_CONTENT);
  mocks.save.mockImplementation(async (input) => input);
});
describe('administración protegida del carrusel', () => {
  it('exige permiso de configuración para leer, guardar y subir', async () => {
    mocks.guard.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await GET()).status).toBe(403);
    expect((await put(DEFAULT_TRACKING_CONTENT)).status).toBe(403);
    expect(
      (
        await POST(
          new Request(
            'http://localhost/api/configuracion/seguimiento/imagenes',
            { method: 'POST' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.guard).toHaveBeenCalledWith('configuracion.editar');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('rechaza un origen ajeno y datos inválidos sin escribir al almacén', async () => {
    expect(
      (await put(DEFAULT_TRACKING_CONTENT, 'https://evil.example')).status,
    ).toBe(403);
    expect(
      (await put({ enabled: true, slides: [], intervalSeconds: 1 })).status,
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('informa fallo de almacenamiento sin simular un guardado', async () => {
    mocks.save.mockRejectedValue(new Error('Storage unavailable'));
    expect((await put(DEFAULT_TRACKING_CONTENT)).status).toBe(503);
  });
  it('rechaza HTML disfrazado y cargas mayores al límite', async () => {
    const form = new FormData();
    form.set(
      'image',
      new File(['<html>fake image</html>'], 'fake.png', { type: 'image/png' }),
    );
    expect(
      (
        await POST(
          new Request(
            'http://localhost/api/configuracion/seguimiento/imagenes',
            { method: 'POST', body: form },
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          new Request(
            'http://localhost/api/configuracion/seguimiento/imagenes',
            { method: 'POST', headers: { 'Content-Length': '9999999' } },
          ),
        )
      ).status,
    ).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
