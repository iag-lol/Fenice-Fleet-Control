/**
 * RUT chileno: normalizacion y validacion del digito verificador.
 *
 * Se usa exclusivamente para el login (no para el RUT comercial de clientes,
 * que vive en la base externa de Fenice y no se valida aqui). Aislar esta
 * logica evita reimplementar el algoritmo modulo 11 en cada formulario.
 */

/**
 * Normaliza un RUT a la forma canonica `12345678-9`: quita puntos y espacios,
 * conserva el guion y pone el digito verificador en mayuscula.
 *
 * Devuelve `null` si el texto no tiene la forma minima de un RUT (cuerpo
 * numerico + digito verificador), sin evaluar todavia si es valido.
 */
export function normalizeRut(input: string): string | null {
  const cleaned = input.trim().replace(/[.\s]/g, '').toUpperCase();
  const match = /^(\d{1,8})-?(\d|K)$/.exec(cleaned);
  if (!match) return null;

  const [, body, verifier] = match as unknown as [string, string, string];
  return `${body}-${verifier}`;
}

/** Calcula el digito verificador esperado para el cuerpo numerico de un RUT. */
function computeVerifier(body: string): string {
  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/**
 * Valida un RUT ya normalizado (`12345678-9`) contra su digito verificador.
 *
 * Acepta tambien texto sin normalizar: normaliza primero y valida despues,
 * para que los formularios puedan llamarla directamente sobre lo que el
 * usuario escribio.
 */
export function isValidRut(input: string): boolean {
  const normalized = normalizeRut(input);
  if (!normalized) return false;

  const [body, verifier] = normalized.split('-') as [string, string];
  // Cuerpos como "0" o excesivamente cortos no corresponden a un RUT real.
  if (Number(body) < 1_000_000) return false;

  return computeVerifier(body) === verifier;
}
