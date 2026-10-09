/** Ejecutar con los escritores GPS detenidos: node --conditions=react-server --import tsx scripts/encrypt-gps-history.ts */
import { loadEnvConfig } from '@next/env';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { protectSensitive, unprotectSensitive } from '../src/lib/sensitive-data';
async function main() {
loadEnvConfig(process.cwd());
if (!process.env.DATA_ENCRYPTION_KEY) throw new Error('Configura la clave de cifrado antes de migrar.');
const directory = resolve(process.env.GPS_HISTORY_DIR?.trim() || '.fenice/gps-history');
let migrated = 0;
for (const name of await readdir(directory).catch(() => [] as string[])) {
  const archive = /^[a-f0-9]{64}-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name);
  if (!archive && !/^last-known-[a-f0-9]{64}\.json$/.test(name)) continue;
  const file = resolve(directory, name);
  const context = `${archive ? 'gps-archive' : 'gps-cache'}:${basename(file)}`;
  const contents = await readFile(file, 'utf8');
  const originals = archive ? contents.split('\n').filter((line) => line.trim()) : [contents];
  const converted = originals.map((line) => {
    const plain = unprotectSensitive(line, context);
    JSON.parse(plain); // No perder silenciosamente un archivo incompleto.
    const encrypted = protectSensitive(plain, context);
    if (unprotectSensitive(encrypted, context) !== plain) throw new Error('Fallo de verificacion de cifrado.');
    return encrypted;
  });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, converted.join('\n') + (archive ? '\n' : ''), { mode: 0o600 });
  await rename(temp, file); migrated++;
}
console.log(JSON.stringify({ encryptedFiles: migrated, verified: true }));

}
void main().catch(() => { console.error("No se completo la migracion de cifrado. Revisa la clave y los archivos antes de reiniciar escritores."); process.exitCode=1; });
