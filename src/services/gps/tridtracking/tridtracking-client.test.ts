import { describe, expect, it, vi } from 'vitest';

import { redactUrl, TridTrackingClient, TridTrackingError } from './tridtracking-client';

const AUTH_OK = {
  Status: { Result: 'Success', ErrorCode: null, Message: null },
  Result: { UserIdGuid: 'user-guid-1', SessionId: 'sesion-1' },
};

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
      String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta([{ Uid: 'u1' }]),
    ) as unknown as typeof fetch;

    await cliente(fetchMock).call('/api/v1.0/units/unit/list');

    const llamada = String((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[1]![0]);
    expect(llamada).toContain('UserIdGuid=user-guid-1');
    expect(llamada).toContain('SessionId=sesion-1');
  });

  it('reutiliza la sesion en lugar de autenticar en cada llamada', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta([]),
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
      return String(url).includes('userauthenticate') ? respuesta(AUTH_OK) : respuesta([]);
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
      return respuesta([{ Uid: 'u1' }]);
    }) as unknown as typeof fetch;

    const datos = await cliente(fetchMock).call<{ Uid: string }[]>('/api/v1.0/units/unit/list');
    expect(datos).toEqual([{ Uid: 'u1' }]);
    expect(llamadasDatos).toBe(2);
  });

  it('no entra en bucle cuando las credenciales son erroneas de verdad', async () => {
    let intentos = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('userauthenticate')) return respuesta(AUTH_OK);
      intentos += 1;
      return respuesta(null, false, 500);
    }) as unknown as typeof fetch;

    await expect(cliente(fetchMock).call('/api/v1.0/units/unit/list')).rejects.toThrow(/500/);
    expect(intentos).toBe(2);
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
