import { describe, expect, it } from 'vitest';

import { getDecoyHash, hashPassword, validatePasswordStrength, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('produce un hash distinto del texto original y lo verifica correctamente', async () => {
    const hash = await hashPassword('ClaveSegura123');
    expect(hash).not.toBe('ClaveSegura123');
    expect(await verifyPassword('ClaveSegura123', hash)).toBe(true);
  });

  it('rechaza una contrasena incorrecta', async () => {
    const hash = await hashPassword('ClaveSegura123');
    expect(await verifyPassword('OtraClave123', hash)).toBe(false);
  });

  it('produce hashes distintos para la misma contrasena (salt aleatorio)', async () => {
    const a = await hashPassword('ClaveSegura123');
    const b = await hashPassword('ClaveSegura123');
    expect(a).not.toBe(b);
  });
});

describe('getDecoyHash', () => {
  it('devuelve siempre el mismo hash señuelo dentro del proceso', async () => {
    const a = await getDecoyHash();
    const b = await getDecoyHash();
    expect(a).toBe(b);
  });

  it('nunca verifica como correcta ninguna contrasena real', async () => {
    const decoy = await getDecoyHash();
    expect(await verifyPassword('ClaveSegura123', decoy)).toBe(false);
  });
});

describe('validatePasswordStrength', () => {
  it('acepta una contrasena que cumple los requisitos', () => {
    expect(validatePasswordStrength('ClaveSegura123')).toEqual([]);
  });

  it('rechaza una contrasena corta', () => {
    expect(validatePasswordStrength('Abc123')).toContain('Debe tener al menos 10 caracteres.');
  });

  it('rechaza una contrasena sin combinar mayusculas y minusculas', () => {
    expect(validatePasswordStrength('clavesegura123')).toContain('Debe combinar mayusculas y minusculas.');
  });

  it('rechaza una contrasena sin numeros', () => {
    expect(validatePasswordStrength('ClaveSeguraSinNumeros')).toContain('Debe incluir al menos un numero.');
  });
});
