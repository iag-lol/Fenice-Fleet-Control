// Uso: node scripts/measure-client-bundle.mjs [directorio .next]
// Peso de JS inicial por ruta; no mide LCP ni tiempo de carga del mapa.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const build = resolve(process.argv[2] ?? '.next');
const { pages } = JSON.parse(readFileSync(resolve(build, 'app-build-manifest.json'), 'utf8'));
const result = {};
for (const route of ['/page', '/control/page', '/flota/page', '/clientes/page', '/territorio/page']) {
  if (!pages[route]) throw new Error(`Ruta ausente del build: ${route}`);
  const files = [...new Set([...(pages['/layout'] ?? []), ...pages[route]])].filter((file) => file.endsWith('.js'));
  const assets = files.map((file) => readFileSync(resolve(build, file)));
  result[route] = {
    files: files.length,
    rawBytes: assets.reduce((sum, data) => sum + data.length, 0),
    gzipBytes: assets.reduce((sum, data) => sum + gzipSync(data).length, 0),
  };
}
console.log(JSON.stringify(result, null, 2));
