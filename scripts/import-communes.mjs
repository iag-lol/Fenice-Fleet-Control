/**
 * Importa los limites comunales OFICIALES de Chile.
 *
 * Fuente: OpenStreetMap via Overpass API, filtrando relaciones de limite
 * administrativo de nivel 8 (comuna). Cada relacion trae la etiqueta
 * `dpachile:id`, que es el codigo de la Division Politico Administrativa
 * publicada por el Estado de Chile: eso ancla la geometria a la nomenclatura
 * oficial en lugar de a nombres escritos a mano.
 *
 * Por que aqui y no en tiempo de ejecucion:
 *   - la plataforma arranca sin depender de un servicio externo,
 *   - la demostracion funciona sin conexion,
 *   - Overpass limita el ritmo de consultas y no admite trafico de produccion.
 *
 * El resultado queda versionado en `src/data/communes-<region>.json` con su
 * fuente y fecha, de modo que reemplazar la cartografia mas adelante sea
 * sustituir un archivo y no reescribir logica.
 *
 * Uso:  npm run import:comunas
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OVERPASS = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
/** Region a importar. Por defecto la Metropolitana, area de operacion actual. */
const REGION_ISO = process.env.REGION_ISO ?? 'CL-RM';
const REGION_NAME = process.env.REGION_NAME ?? 'Region Metropolitana de Santiago';
const OUTPUT_SLUG = process.env.REGION_SLUG ?? 'rm';

/**
 * Tolerancia de simplificacion, en grados aproximados.
 *
 * Los limites oficiales traen decenas de miles de vertices. A escala urbana
 * basta con conservar la forma: mantener el detalle completo multiplicaria el
 * peso de la respuesta sin que el operador note diferencia.
 */
const SIMPLIFY_DEGREES = 0.00025;

async function queryOverpass(query) {
  // Overpass espera la consulta como campo `data` de un formulario; enviarla
  // como texto plano devuelve 406.
  const response = await fetch(OVERPASS, {
    method: 'POST',
    body: new URLSearchParams({ data: query }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'FeniceFleetControl/1.0 (importacion unica de limites comunales)',
    },
    signal: AbortSignal.timeout(240_000),
  });

  if (!response.ok) {
    throw new Error(`Overpass respondio ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/**
 * Ensambla anillos cerrados a partir de los tramos de una relacion.
 *
 * Una relacion de limite no entrega un poligono: entrega tramos sueltos que
 * hay que encadenar por sus extremos, y que pueden venir en cualquier orden y
 * cualquier sentido.
 */
function assembleRings(ways) {
  const pending = ways.map((w) => w.map((p) => [p.lon, p.lat]));
  const rings = [];

  while (pending.length > 0) {
    let ring = pending.shift();
    let extended = true;

    while (extended) {
      extended = false;
      const head = ring[0];
      const tail = ring[ring.length - 1];
      // Anillo ya cerrado: no admite mas tramos.
      if (head[0] === tail[0] && head[1] === tail[1]) break;

      for (let i = 0; i < pending.length; i += 1) {
        const candidate = pending[i];
        const cHead = candidate[0];
        const cTail = candidate[candidate.length - 1];

        if (tail[0] === cHead[0] && tail[1] === cHead[1]) {
          ring = ring.concat(candidate.slice(1));
        } else if (tail[0] === cTail[0] && tail[1] === cTail[1]) {
          ring = ring.concat(candidate.slice(0, -1).reverse());
        } else if (head[0] === cTail[0] && head[1] === cTail[1]) {
          ring = candidate.slice(0, -1).concat(ring);
        } else if (head[0] === cHead[0] && head[1] === cHead[1]) {
          ring = candidate.slice(1).reverse().concat(ring);
        } else {
          continue;
        }

        pending.splice(i, 1);
        extended = true;
        break;
      }
    }

    // Cerrar el anillo si los extremos casi coinciden.
    const head = ring[0];
    const tail = ring[ring.length - 1];
    if (head[0] !== tail[0] || head[1] !== tail[1]) ring.push([head[0], head[1]]);

    if (ring.length >= 4) rings.push(ring);
  }

  return rings;
}

/** Simplificacion Douglas-Peucker sobre coordenadas [lng, lat]. */
function simplifyRing(ring, tolerance) {
  if (ring.length <= 5) return ring;

  const perpendicular = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
  };

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;

    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicular(ring[i], ring[first], ring[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const simplified = ring.filter((_, i) => keep[i] === 1);
  // Nunca devolver algo que ya no sea un poligono valido.
  return simplified.length >= 4 ? simplified : ring;
}

/** Centroide ponderado por area (no el promedio de vertices, que se sesga). */
function polygonCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }

  area *= 0.5;
  if (area === 0) return { lng: ring[0][0], lat: ring[0][1] };

  return { lng: cx / (6 * area), lat: cy / (6 * area) };
}

async function main() {
  console.log(`Importando limites comunales de ${REGION_NAME}`);
  console.log(`Fuente: OpenStreetMap via ${OVERPASS}\n`);

  const query = `
[out:json][timeout:180];
area["ISO3166-2"="${REGION_ISO}"]->.region;
rel(area.region)["boundary"="administrative"]["admin_level"="8"];
out geom;
`;

  const payload = await queryOverpass(query);
  const relations = payload.elements.filter((e) => e.type === 'relation');
  console.log(`  ${relations.length} relaciones de comuna recibidas\n`);

  const communes = [];
  let discarded = 0;

  for (const relation of relations) {
    const name = relation.tags?.name;
    const code = relation.tags?.['dpachile:id'];

    if (!name || !code) {
      discarded += 1;
      continue;
    }

    const outerWays = (relation.members ?? [])
      .filter((m) => m.type === 'way' && m.role !== 'inner' && Array.isArray(m.geometry))
      .map((m) => m.geometry);

    if (outerWays.length === 0) {
      console.log(`  ${name}: sin geometria, descartada`);
      discarded += 1;
      continue;
    }

    const rings = assembleRings(outerWays);
    if (rings.length === 0) {
      console.log(`  ${name}: no fue posible cerrar el poligono, descartada`);
      discarded += 1;
      continue;
    }

    // Se conserva el anillo mayor: las comunas continentales son un solo
    // poligono, y los fragmentos menores son islas o errores de trazado.
    const largest = rings.reduce((a, b) => (b.length > a.length ? b : a));
    const simplified = simplifyRing(largest, SIMPLIFY_DEGREES);

    communes.push({
      code: String(code),
      name,
      region: REGION_NAME,
      center: polygonCentroid(simplified),
      boundary: simplified.map(([lng, lat]) => ({
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      })),
    });

    console.log(
      `  ${String(code).padEnd(7)} ${name.padEnd(24)} ${String(largest.length).padStart(6)} → ${String(simplified.length).padStart(5)} vertices`,
    );
  }

  communes.sort((a, b) => a.name.localeCompare(b.name, 'es'));

  const output = {
    source: 'OpenStreetMap (relaciones de limite administrativo nivel 8)',
    codeSystem: 'Division Politico Administrativa de Chile (dpachile:id)',
    region: REGION_NAME,
    regionIso: REGION_ISO,
    importedAt: new Date().toISOString().slice(0, 10),
    simplifyDegrees: SIMPLIFY_DEGREES,
    license: 'ODbL — © OpenStreetMap contributors',
    communes,
  };

  const path = resolve(process.cwd(), `src/data/communes-${OUTPUT_SLUG}.json`);
  writeFileSync(path, `${JSON.stringify(output)}\n`, 'utf-8');

  console.log(`\n${communes.length} comunas importadas, ${discarded} descartadas`);
  console.log(`Escrito en ${path}`);
}

await main();
