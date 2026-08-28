import 'server-only';

import { getServerEnv } from '@/config/env';

/**
 * Punto de control de acceso de la plataforma.
 *
 * ESTADO ACTUAL: `AUTH_ENABLED=false`. La plataforma esta completamente
 * abierta para desarrollo, demostracion y validacion con Fenice. No existe
 * login, registro ni recuperacion de contrasena, y ninguna pantalla aplica
 * restricciones.
 *
 * POR QUE EXISTE ESTE MODULO: para que activar la autenticacion mas adelante
 * no obligue a reconstruir el sistema. Toda pregunta sobre "quien es el
 * usuario" y "puede hacer esto" pasa por aqui. El dia que Fenice lo requiera:
 *
 *   1. Poner `AUTH_ENABLED=true`.
 *   2. Implementar `resolveSession()` contra el proveedor elegido
 *      (credenciales propias, OAuth corporativo, SSO...).
 *   3. Llamar a `requireAuth()` en las rutas de API y `requirePermission()`
 *      en las acciones sensibles.
 *
 * Nada mas cambia: los componentes, los proveedores y los motores de reglas
 * son indiferentes a la identidad del usuario.
 */

export type Role = 'operador' | 'supervisor' | 'administrador' | 'invitado';

export type Permission =
  | 'flota.ver'
  | 'flota.editar'
  | 'clientes.ver'
  | 'ordenes.ver'
  | 'ordenes.editar'
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
    'alertas.resolver',
  ],
  operador: ['flota.ver', 'clientes.ver', 'ordenes.ver', 'alertas.resolver'],
  invitado: ['flota.ver', 'clientes.ver', 'ordenes.ver'],
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

/**
 * Resuelve la sesion del usuario.
 *
 * PENDIENTE DE IMPLEMENTAR cuando se active la autenticacion: leer la cookie
 * o cabecera de sesion, validarla contra el proveedor y devolver el contexto.
 * Devolver `null` significa "no autenticado".
 */
async function resolveSession(): Promise<AuthContext | null> {
  return null;
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
