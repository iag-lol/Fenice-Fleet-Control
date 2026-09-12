import 'server-only';

import type { TraccarDevice, TraccarPosition } from '@/services/gps/traccar/traccar-mapper';

/**
 * Cliente HTTP de Traccar, sin estado de negocio.
 *
 * Antes esta llamada vivia solo dentro de `TraccarGpsProvider`, fija a las
 * credenciales de `TRACCAR_*`. Se extrae aqui para que "Conectar GPS" (que
 * prueba una conexion con el identificador que el operador acaba de escribir,
 * antes de guardar nada) y el proveedor en vivo usen EXACTAMENTE el mismo
 * codigo de autenticacion y manejo de errores, en vez de mantener dos
 * implementaciones que podrian divergir.
 */

export interface TraccarCredentials {
  baseUrl: string;
  /** `Bearer <token>` o `Basic <base64>`, ya resuelta. */
  authHeader: string | null;
  /** Inyectable en pruebas; usa el `fetch` global en produccion. */
  fetchImpl?: typeof fetch;
}

export class TraccarClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(credentials: TraccarCredentials) {
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, '');
    this.authHeader = credentials.authHeader;
    this.fetchImpl = credentials.fetchImpl ?? fetch;
  }

  /**
   * Lanza `TraccarRequestError` en vez de dejar que el `fetch` reviente con un
   * error generico: "Conectar GPS" necesita distinguir sin adivinar si el
   * servidor no responde, si rechazo las credenciales o si el path no existe.
   */
  async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url: URL;
    try {
      url = new URL(`${this.baseUrl}/api${path}`);
    } catch {
      throw new TraccarRequestError('network', `La URL del servidor no es valida: ${this.baseUrl}`);
    }
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          ...(this.authHeader ? { Authorization: this.authHeader } : {}),
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new TraccarRequestError(
        'network',
        'No fue posible contactar al servidor Traccar.',
        error instanceof Error ? error.message : String(error),
      );
    }

    if (response.status === 401 || response.status === 403) {
      throw new TraccarRequestError('auth', 'El servidor Traccar rechazo las credenciales.');
    }
    if (!response.ok) {
      throw new TraccarRequestError(
        'server',
        `El servidor Traccar respondio ${response.status} en ${path}.`,
        await response.text().catch(() => undefined),
      );
    }

    return (await response.json()) as T;
  }

  async getDevices(): Promise<TraccarDevice[]> {
    return this.request<TraccarDevice[]>('/devices');
  }

  /** Un dispositivo por su `uniqueId` (el "Device Identifier" de Traccar Client), o `null` si no existe. */
  async getDeviceByUniqueId(uniqueId: string): Promise<TraccarDevice | null> {
    const devices = await this.request<TraccarDevice[]>('/devices', { uniqueId });
    return devices.find((d) => d.uniqueId === uniqueId) ?? devices[0] ?? null;
  }

  async getPositions(deviceId?: number): Promise<TraccarPosition[]> {
    return this.request<TraccarPosition[]>('/positions', deviceId ? { deviceId: String(deviceId) } : undefined);
  }
}

/** Motivo tipado: la UI de "Conectar GPS" lo traduce a un mensaje sin jerga. */
export type TraccarRequestErrorReason = 'network' | 'auth' | 'server';

export class TraccarRequestError extends Error {
  constructor(
    readonly reason: TraccarRequestErrorReason,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'TraccarRequestError';
  }
}

/** `Authorization` a partir de token o usuario+clave, igual que hoy resuelve `TraccarGpsProvider`. */
export function buildTraccarAuthHeader(credentials: {
  token?: string;
  username?: string;
  password?: string;
}): string | null {
  if (credentials.token) return `Bearer ${credentials.token}`;
  if (credentials.username && credentials.password) {
    const encoded = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
    return `Basic ${encoded}`;
  }
  return null;
}
