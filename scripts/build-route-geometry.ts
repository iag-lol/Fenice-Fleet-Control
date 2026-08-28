/**
 * Precalculo de la geometria real de las rutas.
 *
 * Las rutas de demostracion se dibujaban uniendo las paradas con tramos
 * sinteticos: lineas que atravesaban manzanas y no se parecian a un recorrido
 * real. Este script consulta un servicio de ruteo (OSRM) y guarda el trazado
 * por calle de cada ruta en `src/data/route-geometry.json`.
 *
 * Se ejecuta fuera del arranque de la aplicacion a proposito:
 *   - el servidor levanta al instante y sin depender de la red,
 *   - la demostracion funciona sin conexion,
 *   - no se consulta un servicio publico en cada arranque.
 *
 * El dataset es determinista, asi que el resultado es estable. Cada entrada
 * lleva la huella de sus paradas: si el dataset cambia, la entrada deja de
 * coincidir y la ruta vuelve al trazado sintetico en vez de mostrar una
 * geometria que no corresponde.
 *
 * Uso:  npm run build:rutas
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getDataset, waypointKey as datasetWaypointKey } from '../src/demo/dataset';
import type { LatLng } from '../src/types/core';

const OSRM_BASE = process.env.OSRM_BASE_URL ?? 'https://router.project-osrm.org';
/**
 * Tolerancia de simplificacion, en metros.
 *
 * OSRM devuelve unos 1.800 vertices por ruta, muy por encima de lo que el
 * mapa necesita para dibujar el recorrido por calle. Simplificar a 6 m
 * conserva cada giro visible y reduce el peso de la respuesta a una fraccion.
 * El motor de cumplimiento de ruta trabaja con tolerancias de cientos de
 * metros, asi que no se ve afectado.
 */
const SIMPLIFY_TOLERANCE_M = 6;
const OUTPUT = resolve(process.cwd(), 'src/demo/route-geometry.json');
/** Pausa entre consultas: el servicio publico de OSRM limita el ritmo. */
const REQUEST_DELAY_MS = 1_200;

interface RouteGeometryEntry {
  key: string;
  distanceKm: number;
  /** Coordenadas [lng, lat], tal como las entrega OSRM. */
  path: [number, number][];
}

/**
 * Huella de las paradas: detecta que el dataset cambio bajo los pies.
 * Se reutiliza la del dataset para que ambas partes calculen lo mismo.
 */
const waypointKey = datasetWaypointKey;

/**
 * Simplificacion Douglas-Peucker sobre coordenadas [lng, lat].
 *
 * La distancia perpendicular se mide en metros mediante una proyeccion plana
 * local, valida a escala urbana.
 */
function simplify(points: [number, number][], toleranceMeters: number): [number, number][] {
  if (points.length <= 2) return points;

  const latRad = (points[0]![1] * Math.PI) / 180;
  const mx = 111_320 * Math.cos(latRad);
  const my = 111_320;

  const perpendicular = (p: [number, number], a: [number, number], b: [number, number]): number => {
    const px = (p[0] - a[0]) * mx;
    const py = (p[1] - a[1]) * my;
    const bx = (b[0] - a[0]) * mx;
    const by = (b[1] - a[1]) * my;
    const lengthSq = bx * bx + by * by;
    if (lengthSq === 0) return Math.hypot(px, py);
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
    return Math.hypot(px - bx * t, py - by * t);
  };

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxDistance = 0;
    let index = -1;

    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicular(points[i]!, points[first]!, points[last]!);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }

    if (index !== -1 && maxDistance > toleranceMeters) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i] === 1);
}

async function fetchRoute(points: LatLng[]): Promise<{ path: [number, number][]; distanceKm: number } | null> {
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      console.warn(`    servicio respondio ${response.status}`);
      return null;
    }

    const payload = (await response.json()) as {
      code: string;
      routes?: { distance: number; geometry: { coordinates: [number, number][] } }[];
    };

    if (payload.code !== 'Ok' || !payload.routes?.[0]) {
      console.warn(`    servicio devolvio code=${payload.code}`);
      return null;
    }

    return {
      // La distancia se conserva de OSRM: es la real por calle, no la de la
      // polilinea simplificada.
      path: simplify(payload.routes[0].geometry.coordinates, SIMPLIFY_TOLERANCE_M),
      distanceKm: Math.round((payload.routes[0].distance / 1000) * 10) / 10,
    };
  } catch (error) {
    console.warn(`    fallo de red: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function main(): Promise<void> {
  const dataset = getDataset();
  const result: Record<string, RouteGeometryEntry> = {};

  console.log(`Calculando geometria real de ${dataset.routes.length} rutas contra ${OSRM_BASE}\n`);

  for (const route of dataset.routes) {
    // Los extremos del corredor son la base operativa; en medio, las paradas.
    //
    // El ultimo vertice del trazado sintetico NO sirve como base: lleva el
    // ruido que ese trazado aplica a cada punto. Se usa el primero, que si es
    // la base exacta, en ambos extremos. La huella tiene que coincidir con la
    // que calcula el dataset o la geometria se descarta por no corresponder.
    const depot = route.plannedPath[0]!;
    const waypoints: LatLng[] = [
      depot,
      ...route.stops
        .map((stop) => stop.coordinates)
        .filter((c): c is LatLng => c !== null),
      depot,
    ];

    process.stdout.write(`  ${route.code}  ${waypoints.length} puntos de paso... `);
    const geometry = await fetchRoute(waypoints);

    if (!geometry) {
      console.log('sin geometria (se usara el trazado sintetico)');
      continue;
    }

    result[route.code] = {
      key: waypointKey(waypoints),
      distanceKm: geometry.distanceKm,
      // Seis decimales equivalen a ~0,1 m: mas precision solo engorda el JSON.
      path: geometry.path.map(([lng, lat]) => [
        Number(lng.toFixed(6)),
        Number(lat.toFixed(6)),
      ]),
    };
    console.log(`${geometry.path.length} vertices, ${geometry.distanceKm} km`);

    await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
  }

  const resolved = Object.keys(result).length;
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 1)}\n`, 'utf-8');

  console.log(`\n${resolved} de ${dataset.routes.length} rutas resueltas`);
  console.log(`Escrito en ${OUTPUT}`);

  if (resolved < dataset.routes.length) {
    console.log('Las rutas sin resolver conservan su trazado sintetico.');
  }
}

void main();
