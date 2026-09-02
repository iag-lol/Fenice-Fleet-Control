import 'server-only';

import type { TridAuthResponse } from './tridtracking-types';

/**
 * Cliente HTTP de 3DTracking.
 *
 * SEGURIDAD: esta API pide `UserIdGuid` y `SessionId` como PARAMETROS DE
 * CONSULTA en cada llamada. Una URL con credenciales acaba en registros de
 * servidor, historiales y cabeceras `Referer`, asi que este modulo es
 * `server-only` y jamas se importa desde un componente de cliente. Las URL
 * que se registran en consola van siempre censuradas.
 */

export class TridTrackingError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'TridTrackingError';
  }
}

interface Session {
  userIdGuid: string;
  sessionId: string;
  obtainedAt: number;
}

export interface TridClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  /** Tiempo maximo por peticion. Un GPS que no responde no puede colgar la UI. */
  timeoutMs?: number;
  /** Vida de la sesion antes de renovarla por precaucion. */
  sessionTtlMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;
/** La API no publica la vida de la sesion: se renueva cada media hora. */
const DEFAULT_SESSION_TTL_MS = 30 * 60_000;

/** Oculta credenciales antes de que una URL llegue a un registro. */
export function redactUrl(url: string): string {
  return url
    .replace(/([?&](?:SessionId|UserIdGuid|password|username)=)[^&]*/gi, '$1***');
}

export class TridTrackingClient {
  private session: Session | null = null;
  private authenticating: Promise<Session> | null = null;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly sessionTtlMs: number;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: TridClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.doFetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new TridTrackingError(
          `3DTracking respondio ${response.status} en ${path}.`,
          null,
          response.status,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof TridTrackingError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new TridTrackingError(
          `3DTracking no respondio en ${this.timeoutMs} ms (${redactUrl(url.toString())}).`,
        );
      }
      throw new TridTrackingError(
        `No fue posible contactar con 3DTracking: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Autentica y guarda la sesion.
   *
   * Las llamadas concurrentes comparten una unica autenticacion en curso: al
   * arrancar, varias pantallas piden posiciones a la vez y abrir cinco
   * sesiones simultaneas es la forma tipica de que el proveedor bloquee la
   * cuenta.
   */
  private async authenticate(): Promise<Session> {
    if (this.authenticating) return this.authenticating;

    this.authenticating = (async () => {
      const payload = await this.request<TridAuthResponse>(
        '/api/v1.0/authentication/userauthenticate',
        { username: this.options.username, password: this.options.password },
      );

      const resultado = (payload.Status?.Result ?? '').trim().toLowerCase();
      const userIdGuid = (payload.Result?.UserIdGuid ?? '').trim();
      const sessionId = (payload.Result?.SessionId ?? '').trim();

      if (userIdGuid === '' || sessionId === '') {
        throw new TridTrackingError(
          payload.Status?.Message?.trim() ||
            '3DTracking no devolvio una sesion. Revisa usuario y contraseña.',
          payload.Status?.ErrorCode ?? null,
        );
      }
      if (resultado !== '' && resultado !== 'success' && resultado !== 'ok') {
        throw new TridTrackingError(
          payload.Status?.Message?.trim() || `Autenticacion rechazada (${resultado}).`,
          payload.Status?.ErrorCode ?? null,
        );
      }

      return { userIdGuid, sessionId, obtainedAt: Date.now() };
    })();

    try {
      this.session = await this.authenticating;
      return this.session;
    } finally {
      this.authenticating = null;
    }
  }

  private async getSession(): Promise<Session> {
    const vigente =
      this.session !== null && Date.now() - this.session.obtainedAt < this.sessionTtlMs;
    return vigente ? this.session! : this.authenticate();
  }

  /**
   * Llamada autenticada, con un reintento si la sesion caduco.
   *
   * La API no distingue con claridad "sesion expirada" de otros errores, asi
   * que ante un fallo se renueva la sesion UNA vez y se reintenta. Mas de un
   * reintento convertiria unas credenciales erroneas en un bucle de peticiones.
   */
  async call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const intentar = async (session: Session): Promise<T> =>
      this.request<T>(path, {
        ...params,
        UserIdGuid: session.userIdGuid,
        SessionId: session.sessionId,
      });

    const session = await this.getSession();
    try {
      return await intentar(session);
    } catch (error) {
      this.session = null;
      const renovada = await this.authenticate();
      try {
        return await intentar(renovada);
      } catch {
        throw error;
      }
    }
  }

  /** Comprobacion de conectividad y credenciales, sin efectos secundarios. */
  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    const inicio = Date.now();
    try {
      await this.authenticate();
      return {
        ok: true,
        message: 'Sesion establecida con 3DTracking.',
        latencyMs: Date.now() - inicio,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - inicio,
      };
    }
  }

  /** Solo para pruebas: descarta la sesion en memoria. */
  resetSession(): void {
    this.session = null;
  }
}
