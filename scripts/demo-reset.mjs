/**
 * Reinicia el mundo de demostracion.
 *
 * Borra la geometria de rutas cacheada para que se recalcule contra el
 * servicio de ruteo, y descarta la compilacion para que el proximo arranque
 * genere el dataset desde cero.
 *
 * Uso:  npm run demo:reset
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

writeFileSync(resolve(root, 'src/demo/route-geometry.json'), '{}\n', 'utf-8');
console.log('Geometria de rutas descartada.');

const nextDir = resolve(root, '.next');
if (existsSync(nextDir)) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('Compilacion descartada.');
}

console.log('\nEjecuta a continuacion:');
console.log('  npm run build:rutas   para recalcular las rutas por calle');
console.log('  npm run dev           para levantar la plataforma');
