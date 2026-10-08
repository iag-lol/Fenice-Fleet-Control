import { afterEach, describe, expect, it, vi } from 'vitest';

import { redactUrl, TridTrackingClient, TridTrackingError } from './tridtracking-client';

const AUTH_OK = {
  Status: { Result: 'Success', ErrorCode: null, Message: null },
  Result: { UserIdGuid: 'user-guid-1', SessionId: 'sesion-1' },
};
afterEach(() => vi.useRealTimers());

function respuesta(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

function cliente(fetchImpl: typeof fetch) {
  return new TridTrackingClient({
    baseUrl: 'https://apiv2.3dtracking.net/',
    username: 'usuario',
    password: 'secreta',
    fetchImpl,
  });
}

describe('credenciales en la URL', () => {
  it('censura la sesion y la contraseña antes de registrarlas', () => {
    // Esta API pide las credenciales como parametros de consulta: una URL sin
    // censurar acabaria intacta en los registros del servidor.
    const url =
      'https://apiv2.3dtracking.net/api/v1.0/units/latestpositionslist?UserIdGuid=abc&SessionId=xyz&password=secreta';
    const censurada = redactUrl(url);

    expect(censurada).not.toContain('xyz');
    expect(censurada).not.toContain('abc');
    expect(censurada).not.toContain('secreta');
    expect(censurada).toContain('SessionId=***');
  });
});

describe('autenticacion', () => {
  it('adjunta la sesion obtenida a cada llamada', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta({ Status: { Result: 'Success' }, Result: [{ Uid: 'u1' }] }),
    ) as unknown as typeof fetch;

    await cliente(fetchMock).call('/api/v1.0/units/unit/list');

    const llamada = String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![0]);
    expect(llamada).toContain('UserIdGuid=user-guid-1');
    expect(llamada).toContain('SessionId=sesion-1');
  });

  it('reutiliza la sesion en lugar de autenticar en cada llamada', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta({ Status: { Result: 'Success' }, Result: [] }),
    ) as unknown as typeof fetch;

    const c = cliente(fetchMock);
    await c.call('/api/v1.0/units/unit/list');
    await c.call('/api/v1.0/units/latestpositionslist');

    const auths = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('userauthenticate'),
    );
    expect(auths).toHaveLength(1);
  });

  it('no abre varias sesiones cuando varias pantallas piden a la vez', async () => {
    // Abrir cinco sesiones simultaneas es la forma tipica de que el proveedor
    // bloquee la cuenta.
    const fetchMock = vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 5));
      return String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta({ Status: { Result: 'Success' }, Result: [] });
    }) as unknown as typeof fetch;

    const c = cliente(fetchMock);
    await Promise.all([
      c.call('/api/v1.0/units/unit/list'),
      c.call('/api/v1.0/units/latestpositionslist'),
      c.call('/api/v1.0/alerts/alerts/list'),
    ]);

    const auths = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).includes('userauthenticate'),
    );
    expect(auths).toHaveLength(1);
  });

  it('rechaza credenciales invalidas con el mensaje del proveedor', async () => {
    const fetchMock = vi.fn(async () =>
      respuesta({
        Status: { Result: 'Failure', ErrorCode: 'AUTH_001', Message: 'Usuario o clave incorrectos' },
        Result: null,
      }),
    ) as unknown as typeof fetch;

    await expect(cliente(fetchMock).call('/api/v1.0/units/unit/list')).rejects.toThrow(
      /Usuario o clave incorrectos/,
    );
  });

  it('rechaza una respuesta sin sesion aunque diga Success', async () => {
    const fetchMock = vi.fn(async () =>
      respuesta({ Status: { Result: 'Success' }, Result: { UserIdGuid: '', SessionId: '' } }),
    ) as unknown as typeof fetch;

    await expect(cliente(fetchMock).call('/api/v1.0/units/unit/list')).rejects.toBeInstanceOf(
      TridTrackingError,
    );
  });
});

describe('sesion caducada', () => {
  it('renueva la sesion y reintenta una sola vez', async () => {
    let llamadasDatos = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('userauthenticate')) return respuesta(AUTH_OK);
      llamadasDatos += 1;
      // El primer intento falla como si la sesion hubiese expirado.
      if (llamadasDatos === 1) return respuesta(null, false, 401);
      return respuesta({ Status: { Result: 'Success' }, Result: [{ Uid: 'u1' }] });
    }) as unknown as typeof fetch;

    const datos = await cliente(fetchMock).call<{ Uid: string }[]>('/api/v1.0/units/unit/list');
    expect(datos).toEqual([{ Uid: 'u1' }]);
    expect(llamadasDatos).toBe(2);
  });

  it('no renueva la sesion ante un error 500 del proveedor', async () => {
    let intentos = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('userauthenticate')) return respuesta(AUTH_OK);
      intentos += 1;
      return respuesta(null, false, 500);
    }) as unknown as typeof fetch;

    await expect(cliente(fetchMock).call('/api/v1.0/units/unit/list')).rejects.toThrow(/500/);
    expect(intentos).toBe(1);
  });
});

describe('diagnostico', () => {
  it('informa del fallo sin lanzar, para poder mostrarlo en pantalla', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;

    const estado = await cliente(fetchMock).healthCheck();
    expect(estado.ok).toBe(false);
    expect(estado.message).toContain('ECONNREFUSED');
    expect(estado.latencyMs).not.toBeNull();
  });

  it('confirma la conexion cuando las credenciales sirven', async () => {
    const fetchMock = vi.fn(async () => respuesta(AUTH_OK)) as unknown as typeof fetch;
    const estado = await cliente(fetchMock).healthCheck();
    expect(estado.ok).toBe(true);
  });
});

describe('contrato oficial Status y Result', () => {
  it('detecta errores del proveedor aunque HTTP responda 200', async () => {
    const fetchMock = vi.fn(async (url: string) => String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta({ Status: { Result: 'Failure', ErrorCode: 'PERMISSION', Message: 'Sin acceso a la flota' }, Result: null })) as unknown as typeof fetch;
    await expect(cliente(fetchMock).call('/api/v1.0/units/unit/list')).rejects.toThrow('Sin acceso a la flota');
  });
  it('renueva una sesion expirada informada dentro de Status', async () => {
    let attempts = 0;
    const fetchMock = vi.fn(async (url: string) => String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta(++attempts === 1 ? { Status: { Result: 'Failure', ErrorCode: 'SESSION_EXPIRED', Message: 'Session expired' }, Result: null } : { Status: { Result: 'Success' }, Result: [1] })) as unknown as typeof fetch;
    expect(await cliente(fetchMock).call('/positions')).toEqual([1]);
    expect(attempts).toBe(2);
  });
  it('no filtra credenciales si fetch incluye la URL en su error', async () => {
    const fetchMock = vi.fn(async (url: string) => { throw new Error('Error '+url); }) as unknown as typeof fetch;
    const result = await cliente(fetchMock).healthCheck();
    expect(result.message).not.toContain('password=secreta');
    expect(result.message).not.toContain('username=usuario');
  });
  it('no abre una sesion nueva en cada diagnostico', async () => {
    const fetchMock = vi.fn(async () => respuesta(AUTH_OK)) as unknown as typeof fetch;
    const c = cliente(fetchMock); await c.healthCheck(); await c.healthCheck();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it('usa la autenticación documentada de Partner API con nombres de parámetros exactos', async () => {
  const fetchMock = vi.fn(async () => respuesta(AUTH_OK)) as unknown as typeof fetch;
  const client = new TridTrackingClient({ baseUrl: 'https://partnerapi.3dtracking.net', username: 'test-user', password: 'test-password', apiMode: 'partner', fetchImpl: fetchMock });
  expect((await client.healthCheck()).ok).toBe(true);
  const [address, options] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
  const url = new URL(String(address));
  expect(url.pathname).toBe('/api/v1.0/Authentication/UserAuthenticate');
  expect(url.searchParams.get('UserName')).toBe('test-user');
  expect(url.searchParams.get('Password')).toBe('test-password');
  expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
  expect(redactUrl(url.toString())).not.toContain('test-password');
});

describe('limites de frecuencia del proveedor', () => {
  it('respeta Retry-After HTTP y pausa tambien el diagnostico sin autenticar otra vez', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta(AUTH_OK))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValueOnce(respuesta({ Status: { Result: 'ok' }, Result: [] }));
    const c = cliente(fetchMock as typeof fetch);
    await expect(c.call('/positions')).rejects.toMatchObject({ status: 429, retryAfterMs: 120000 });
    await expect(c.call('/units')).rejects.toMatchObject({ status: 429 });
    expect((await c.healthCheck()).ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120000);
    expect(await c.call('/positions')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('reconoce el limite dentro de HTTP 200 y aumenta la pausa si se repite', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string) => String(url).includes('userauthenticate')
      ? respuesta(AUTH_OK)
      : respuesta({ Status: { Result: 'error', ErrorCode: 'LIMIT', Message: 'Too Many Requests. Rate limit reached.' }, Result: null }));
    const c = cliente(fetchMock as unknown as typeof fetch);
    await expect(c.call('/positions')).rejects.toMatchObject({ status: 429, retryAfterMs: 60000 });
    await Promise.allSettled([c.call('/positions'), c.call('/units')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    await expect(c.call('/positions')).rejects.toMatchObject({ status: 429, retryAfterMs: 120000 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('interpreta Retry-After como fecha HTTP sin adelantar el siguiente intento', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta(AUTH_OK))
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': 'Thu, 08 Oct 2026 12:02:00 GMT' } }));
    await expect(cliente(fetchMock as typeof fetch).call('/positions')).rejects.toMatchObject({ retryAfterMs: 120000 });
  });
  it('pausa autenticaciones cuando el limite se aplica al inicio de sesion', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response(null, { status: 429 }));
    const c = cliente(fetchMock as typeof fetch);
    expect((await c.healthCheck()).ok).toBe(false);
    expect((await c.healthCheck()).message).toContain('frecuencia');
    await expect(c.call('/positions')).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
