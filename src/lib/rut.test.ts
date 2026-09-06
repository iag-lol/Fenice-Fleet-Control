import { describe, expect, it } from 'vitest';

import { isValidRut, normalizeRut } from './rut';

describe('normalizeRut', () => {
  it('quita puntos y espacios, conserva el guion', () => {
    expect(normalizeRut('12.345.678-5')).toBe('12345678-5');
    expect(normalizeRut(' 12345678-5 ')).toBe('12345678-5');
  });

  it('pone en mayuscula el digito verificador K', () => {
    expect(normalizeRut('8765432-k')).toBe('8765432-K');
  });

  it('acepta el RUT sin guion', () => {
    expect(normalizeRut('123456785')).toBe('12345678-5');
  });

  it('devuelve null para texto que no tiene forma de RUT', () => {
    expect(normalizeRut('')).toBeNull();
    expect(normalizeRut('abc-1')).toBeNull();
    expect(normalizeRut('123456789012-3')).toBeNull();
  });
});

describe('isValidRut', () => {
  it('acepta RUT validos con distintos digitos verificadores', () => {
    expect(isValidRut('12345678-5')).toBe(true);
    expect(isValidRut('76543210-3')).toBe(true);
    expect(isValidRut('8765432-K')).toBe(true);
    expect(isValidRut('1000005-K')).toBe(true);
  });

  it('acepta variantes de formato del mismo RUT valido', () => {
    expect(isValidRut('12.345.678-5')).toBe(true);
    expect(isValidRut('12345678-5 ')).toBe(true);
    expect(isValidRut('8765432-k')).toBe(true);
  });

  it('rechaza un digito verificador incorrecto', () => {
    expect(isValidRut('12345678-9')).toBe(false);
    expect(isValidRut('12345678-0')).toBe(false);
  });

  it('rechaza texto sin forma de RUT', () => {
    expect(isValidRut('')).toBe(false);
    expect(isValidRut('abcdefgh-5')).toBe(false);
  });

  it('rechaza cuerpos numericos demasiado pequenos aunque el digito calce', () => {
    // El digito verificador de "1" es realmente "9", pero un RUT de un solo
    // digito no corresponde a ninguna persona o empresa real.
    expect(isValidRut('1-9')).toBe(false);
  });
});
