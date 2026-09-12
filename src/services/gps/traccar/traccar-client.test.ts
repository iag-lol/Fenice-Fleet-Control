import { describe, expect, it, vi } from 'vitest';

import { buildTraccarAuthHeader, TraccarClient, TraccarRequestError } from './traccar-client';

function respuesta(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function cliente(fetchImpl: typeof fetch, authHeader: string | null = 'Bearer token-1') {
  return new TraccarClient({ baseUrl: 'https://gps.midominio.cl', authHeader, fetchImpl });
}

describe('buildTraccarAuthHeader', () => {
  it('prefiere el token cuando esta presente', () => {
    expect(buildTraccarAuthHeader({ token: 't1', username: 'u', password: 'p' })).toBe('Bearer t1');
  });

  it('cae a Basic con usuario y clave si no hay token', () => {
    const header = buildTraccarAuthHeader({ username: 'admin', password: 'secreta' });
    expect(header).toMatch(/^Basic /);
  });

  it('devuelve null sin ninguna credencial', () => {
    expect(buildTraccarAuthHeader({})).toBeNull();
  });
});

describe('TraccarClient', () => {
  it('adjunta la cabecera de autenticacion y arma la URL bajo /api', async () => {
    const fetchMock = vi.fn(async () => respuesta([])) as unknown as typeof fetch;
    await cliente(fetchMock).getDevices();

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe('https://gps.midominio.cl/api/devices');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer token-1' });
  });

  it('quita la barra final del servidor antes de construir la URL', async () => {
    const fetchMock = vi.fn(async () => respuesta([])) as unknown as typeof fetch;
    const client = new TraccarClient({ baseUrl: 'https://gps.midominio.cl///', authHeader: null, fetchImpl: fetchMock });
    await client.getDevices();
    expect(String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toBe(
      'https://gps.midominio.cl/api/devices',
    );
  });

  it('encuentra el dispositivo por uniqueId', async () => {
    const fetchMock = vi.fn(async () =>
      respuesta([{ id: 42, uniqueId: '123456789', name: 'Telefono de prueba', status: 'online', lastUpdate: null }]),
    ) as unknown as typeof fetch;

    const device = await cliente(fetchMock).getDeviceByUniqueId('123456789');
    expect(device?.id).toBe(42);
  });

  it('devuelve null si Traccar no reconoce el identificador', async () => {
    const fetchMock = vi.fn(async () => respuesta([])) as unknown as typeof fetch;
    const device = await cliente(fetchMock).getDeviceByUniqueId('no-existe');
    expect(device).toBeNull();
  });

  it('distingue credenciales rechazadas de un servidor inalcanzable', async () => {
    const rechazo = vi.fn(async () => respuesta(null, false, 401)) as unknown as typeof fetch;
    await expect(cliente(rechazo).getDevices()).rejects.toMatchObject({ reason: 'auth' });

    const inalcanzable = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(cliente(inalcanzable).getDevices()).rejects.toMatchObject({ reason: 'network' });
  });

  it('reporta un error de servidor con su codigo de estado', async () => {
    const fetchMock = vi.fn(async () => respuesta('boom', false, 500)) as unknown as typeof fetch;
    const error = await cliente(fetchMock)
      .getDevices()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TraccarRequestError);
    expect((error as TraccarRequestError).reason).toBe('server');
    expect((error as TraccarRequestError).message).toContain('500');
  });
});
