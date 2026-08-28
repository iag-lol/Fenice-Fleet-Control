/**
 * Elimina toda la informacion de demostracion de la plataforma.
 *
 * Deja `DEMO_MODE=false` en `.env.local`, con lo que la puerta de acceso al
 * dataset (`src/demo/index.ts`) devuelve un mundo vacio. La plataforma sigue
 * funcionando: muestra sus estados vacios y espera a que se conecten las
 * fuentes reales.
 *
 * Es una sola operacion, deliberadamente: revisar a mano donde quedo un dato
 * ficticio es exactamente lo que este comando existe para evitar.
 *
 * Uso:  npm run demo:purge
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envPath = resolve(root, '.env.local');

const existing = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';

/** Fija una variable en el contenido del archivo, respetando lo demas. */
function setVariable(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  return pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;
}

let updated = existing;
updated = setVariable(updated, 'DEMO_MODE', 'false');
updated = setVariable(updated, 'NEXT_PUBLIC_DEMO_MODE', 'false');

writeFileSync(envPath, updated.startsWith('\n') ? updated.slice(1) : updated, 'utf-8');
console.log('DEMO_MODE=false escrito en .env.local');

writeFileSync(resolve(root, 'src/demo/route-geometry.json'), '{}\n', 'utf-8');
console.log('Geometria de rutas de demostracion eliminada.');

const nextDir = resolve(root, '.next');
if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('Compilacion descartada.');
}

console.log('\nLa plataforma ya no servira informacion de demostracion.');
console.log('Conecta las fuentes reales con GPS_PROVIDER y OPERATIONS_PROVIDER.');
