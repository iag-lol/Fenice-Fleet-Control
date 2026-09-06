import 'server-only';

import bcrypt from 'bcryptjs';

/**
 * Hash y verificacion de contrasenas.
 *
 * `bcryptjs` es una implementacion en JavaScript puro: no requiere compilar
 * un addon nativo, lo que la hace segura de desplegar tanto en el runtime de
 * Node como en Edge sin pasos adicionales. El costo de trabajo (12) es mas
 * alto que el default de bcrypt (10) porque el login no es una operacion de
 * alta frecuencia: el costo extra (unos cientos de milisegundos) es
 * imperceptible para una persona iniciando sesion y encarece fuerza bruta.
 */
const COST_FACTOR = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Hash señuelo, precalculado una sola vez, para comparar cuando el RUT no
 * corresponde a ningun usuario.
 *
 * Sin esto, un intento de login con un RUT inexistente responde mas rapido
 * que uno con RUT existente y contrasena incorrecta (no hay bcrypt.compare
 * de por medio), lo que permite a un atacante enumerar RUTs validos midiendo
 * el tiempo de respuesta. Comparar siempre contra un hash, exista o no el
 * usuario, iguala el costo de ambos caminos.
 */
let decoyHashPromise: Promise<string> | null = null;

export function getDecoyHash(): Promise<string> {
  if (!decoyHashPromise) {
    decoyHashPromise = hashPassword(`decoy-${crypto.randomUUID()}`);
  }
  return decoyHashPromise;
}

/** Requisitos minimos de una contrasena nueva (alta de usuario, no login). */
export function validatePasswordStrength(password: string): string[] {
  const errors: string[] = [];

  if (password.length < 10) {
    errors.push('Debe tener al menos 10 caracteres.');
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    errors.push('Debe combinar mayusculas y minusculas.');
  }
  if (!/\d/.test(password)) {
    errors.push('Debe incluir al menos un numero.');
  }

  return errors;
}
