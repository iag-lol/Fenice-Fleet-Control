import 'server-only';

import type { TridAuthResponse, TridResponse } from './tridtracking-types';

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

  private safeMessage(message: string): string {
    let safe = redactUrl(message);
    for (const secret of [this.options.username, this.options.password, this.session?.sessionId, this.session?.userIdGuid]) {
      if (secret) safe = safe.replaceAll(secret, '***').replaceAll(encodeURIComponent(secret), '***');
    }
    return safe;
  }

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
        redirect: 'error',
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
        `No fue posible contactar con 3DTracking: ${this.safeMessage(error instanceof Error ? error.message : String(error))}`,
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
          this.safeMessage(payload.Status?.Message?.trim() ||
            '3DTracking no devolvio una sesion. Revisa usuario y contraseña.'),
          payload.Status?.ErrorCode ?? null,
        );
      }
      if (resultado !== '' && resultado !== 'success' && resultado !== 'ok') {
        throw new TridTrackingError(
          this.safeMessage(payload.Status?.Message?.trim() || `Autenticacion rechazada (${resultado}).`),
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
   * Los errores de autenticacion o sesion permiten una renovacion. Los
   * errores de red, formato y servidor no abren sesiones adicionales.
   */
  async call<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const intentar = async (session: Session): Promise<T> => {
      const payload = await this.request<TridResponse<T>>(path, {
        ...params,
        UserIdGuid: session.userIdGuid,
        SessionId: session.sessionId,
      });
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TridTrackingError(`Respuesta de 3DTracking incompatible en ${path}.`, 'FORMAT');
      }
      const result = (payload.Status?.Result ?? '').trim().toLowerCase();
      if (result !== '' && result !== 'success' && result !== 'ok') {
        throw new TridTrackingError(this.safeMessage(payload.Status?.Message || `3DTracking rechazo ${path}.`),
          payload.Status?.ErrorCode ?? null);
      }
      if (!('Result' in payload)) throw new TridTrackingError(`Respuesta de 3DTracking sin Result en ${path}.`, 'FORMAT');
      return payload.Result as T;
    };

    const session = await this.getSession();
    try {
      return await intentar(session);
    } catch (error) {
      const expired = error instanceof TridTrackingError &&
        (error.status === 401 || error.status === 403 ||
          /session|auth|token|expir|unauthor/i.test(`${error.code ?? ''} ${error.message}`));
      if (!expired) throw error;
      // Una respuesta de la sesion anterior no debe invalidar una sesion
      // que otra peticion concurrente acaba de renovar.
      if (this.session === session) this.session = null;
      return intentar(await this.getSession());
    }
  }

  /** Comprobacion de conectividad y credenciales, sin efectos secundarios. */
  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    const inicio = Date.now();
    try {
      await this.getSession();
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
