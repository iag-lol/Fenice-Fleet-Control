import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
function keys(): Buffer[] {
  const configured = [process.env.DATA_ENCRYPTION_KEY, ...(process.env.DATA_ENCRYPTION_PREVIOUS_KEYS?.split(',') ?? [])]
    .filter((value): value is string => Boolean(value));
  const result = configured.map((value) => Buffer.from(value, 'base64'));
  if (result.some((key) => key.length !== 32)) throw new Error('Clave de cifrado invalida.');
  return result;
}
const keyId = (key: Buffer) => createHash('sha256').update(key).digest('hex').slice(0, 16);

/** AES-256-GCM, IV aleatorio por registro y contexto autenticado (AAD). */
export function protectSensitive(value: string, context: string): string {
  const key = keys()[0];
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('Falta la clave de cifrado del servidor.');
    return value; // Solo pruebas/desarrollo sin persistencia productiva.
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${keyId(key)}:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function unprotectSensitive(value: string, context: string): string {
  if (!value.startsWith(PREFIX)) return value; // Compatibilidad de lectura con registros anteriores.
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 4) throw new Error('Registro cifrado invalido.');
  const [id, ivText, tagText, ciphertext] = parts as [string, string, string, string];
  const key = keys().find((candidate) => keyId(candidate) === id);
  if (!key) throw new Error('No se dispone de la clave para este registro.');
  const iv = Buffer.from(ivText, 'base64url'); const tag = Buffer.from(tagText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Registro cifrado invalido.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}
