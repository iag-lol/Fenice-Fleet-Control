/**
 * Limpia `.next` cuando contiene una compilacion de produccion.
 *
 * Arrancar `next dev` sobre artefactos dejados por `next build` produce un
 * fallo desconcertante: la pagina se sirve SIN estilos, con el HTML crudo y
 * los datos vacios, mientras el servidor registra ENOENT de manifiestos.
 * Parece que la aplicacion se rompio, cuando en realidad solo hay dos
 * compilaciones incompatibles mezcladas.
 *
 * Se detecta por `BUILD_ID`, que solo existe en compilaciones de produccion:
 * el ciclo normal de desarrollo no vuelve a compilar de mas.
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const nextDir = resolve(process.cwd(), '.next');

if (existsSync(resolve(nextDir, 'BUILD_ID'))) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('Se descarto una compilacion de produccion previa en .next');
}
