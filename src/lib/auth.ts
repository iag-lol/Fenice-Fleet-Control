import 'server-only';

import { getServerEnv } from '@/config/env';
import { resolveSessionFromCookies } from '@/lib/session';

/**
 * Punto de control de acceso de la plataforma.
 *
 * Login propio por RUT y contrasena (tabla `usuarios` en Supabase, sesiones
 * en `sesiones`), sin Supabase Auth. La resolucion real de la sesion vive en
 * `src/lib/session.ts`; este modulo traduce esa sesion al contexto de
 * autorizacion (`AuthContext`) que consume el resto de la aplicacion.
 *
 * Con `AUTH_ENABLED=false` la plataforma opera en modo abierto (desarrollo o
 * demostracion sin Supabase configurado): todo permitido, sin usuario
 * asociado. Es el mismo comportamiento que tenia el andamiaje original.
 */

export type Role = 'operador' | 'supervisor' | 'administrador' | 'invitado';

export type Permission =
  | 'flota.ver'
  | 'flota.editar'
  | 'clientes.ver'
  | 'ordenes.ver'
  | 'ordenes.editar'
  | 'rutas.ver'
  | 'rutas.editar'
  | 'geocercas.ver'
  | 'geocercas.editar'
  | 'alertas.resolver'
  | 'configuracion.editar';

export interface AuthContext {
  /** `true` cuando la autenticacion esta activa y hay sesion valida. */
  authenticated: boolean;
  /** `true` mientras la plataforma opera en modo abierto. */
  openAccess: boolean;
  userId: string | null;
  displayName: string | null;
  role: Role;
  permissions: ReadonlySet<Permission>;
}

const ALL_PERMISSIONS: readonly Permission[] = [
  'flota.ver',
  'flota.editar',
  'clientes.ver',
  'ordenes.ver',
  'ordenes.editar',
  'rutas.ver',
  'rutas.editar',
  'geocercas.ver',
  'geocercas.editar',
  'alertas.resolver',
  'configuracion.editar',
];

/** Permisos por rol. Se aplica solo cuando la autenticacion esta activa. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  administrador: ALL_PERMISSIONS,
  supervisor: [
    'flota.ver',
    'flota.editar',
    'clientes.ver',
    'ordenes.ver',
    'ordenes.editar',
    'rutas.ver',
    'rutas.editar',
    'geocercas.ver',
    'geocercas.editar',
    'alertas.resolver',
  ],
  operador: ['flota.ver', 'clientes.ver', 'ordenes.ver', 'rutas.ver', 'geocercas.ver', 'alertas.resolver'],
  invitado: ['flota.ver', 'clientes.ver', 'ordenes.ver', 'rutas.ver', 'geocercas.ver'],
};

/**
 * Contexto de acceso mientras la autenticacion esta desactivada: todo
 * permitido, sin usuario asociado.
 */
const OPEN_CONTEXT: AuthContext = {
  authenticated: false,
  openAccess: true,
  userId: null,
  displayName: null,
  role: 'administrador',
  permissions: new Set(ALL_PERMISSIONS),
};

/** Resuelve la sesion del usuario contra la cookie de la peticion actual. */
async function resolveSession(): Promise<AuthContext | null> {
  const session = await resolveSessionFromCookies();
  if (!session) return null;

  return {
    authenticated: true,
    openAccess: false,
    userId: session.id,
    displayName: session.nombreCompleto,
    role: session.rol,
    permissions: new Set(ROLE_PERMISSIONS[session.rol]),
  };
}

/** Contexto de acceso vigente. Nunca lanza. */
export async function getAuthContext(): Promise<AuthContext> {
  if (!getServerEnv().AUTH_ENABLED) return OPEN_CONTEXT;

  const session = await resolveSession();
  if (session) return session;

  return {
    authenticated: false,
    openAccess: false,
    userId: null,
    displayName: null,
    role: 'invitado',
    permissions: new Set(),
  };
}

export class UnauthorizedError extends Error {
  constructor(message = 'Se requiere iniciar sesion para realizar esta accion.') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(readonly permission: Permission) {
    super(`No tienes el permiso "${permission}" para realizar esta accion.`);
    this.name = 'ForbiddenError';
  }
}

/**
 * Exige sesion valida. No hace nada mientras `AUTH_ENABLED=false`, por lo que
 * puede colocarse desde ya en las rutas que lo requeriran.
 */
export async function requireAuth(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (context.openAccess || context.authenticated) return context;
  throw new UnauthorizedError();
}

/** Exige un permiso concreto. Inerte en modo abierto. */
export async function requirePermission(permission: Permission): Promise<AuthContext> {
  const context = await requireAuth();
  if (context.openAccess || context.permissions.has(permission)) return context;
  throw new ForbiddenError(permission);
}

/** Consulta sin lanzar, para decidir si mostrar o no una accion en la UI. */
export async function hasPermission(permission: Permission): Promise<boolean> {
  const context = await getAuthContext();
  return context.openAccess || context.permissions.has(permission);
}
