// El navegador necesita el encuadre, no todos los poligonos dentro del bundle.
// Se regenera al importar cartografia y antes de arrancar/compilar.
import { readFileSync, writeFileSync } from 'node:fs';

const source = JSON.parse(readFileSync(new URL('../src/data/communes-rm.json', import.meta.url), 'utf8'));
const bounds = { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity };
for (const commune of source.communes) {
  for (const point of commune.boundary) {
    bounds.minLat = Math.min(bounds.minLat, point.lat);
    bounds.maxLat = Math.max(bounds.maxLat, point.lat);
    bounds.minLng = Math.min(bounds.minLng, point.lng);
    bounds.maxLng = Math.max(bounds.maxLng, point.lng);
  }
}
if (!Object.values(bounds).every(Number.isFinite)) throw new Error('Cartografia comunal sin limites validos.');
writeFileSync(new URL('../src/data/map-viewport.json', import.meta.url), `${JSON.stringify(bounds)}\n`);
