/**
 * Limpia `.next` antes de compilar.
 *
 * Modo por defecto (`predev`): solo borra `.next` cuando contiene una
 * compilacion de PRODUCCION (detectado por `BUILD_ID`, que `next dev` nunca
 * genera). Arrancar `next dev` sobre artefactos dejados por `next build`
 * produce un fallo desconcertante: la pagina se sirve SIN estilos, con el
 * HTML crudo y los datos vacios, mientras el servidor registra ENOENT de
 * manifiestos. Parece que la aplicacion se rompio, cuando en realidad solo
 * hay dos compilaciones incompatibles mezcladas.
 *
 * Modo `--force` (`prebuild`, antes de `next build`): borra `.next`
 * incondicionalmente. Varias plataformas (Render incluida) conservan la
 * carpeta `.next` entre despliegues para acelerar el build siguiente, pero
 * eso incluye la Full Route Cache: paginas estaticas como `/login` pueden
 * seguir sirviendo el HTML generado en el despliegue ANTERIOR aunque el
 * codigo fuente cambio y el build "termino bien" (`x-nextjs-cache: HIT`
 * delata este caso exacto). `next build` no puede detectar por si solo que
 * esa cache quedo obsoleta, asi que se fuerza un build limpio en cada
 * despliegue en vez de confiar en la cache incremental de la plataforma.
 */

import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const force = process.argv.includes('--force');
const nextDir = resolve(process.cwd(), '.next');

if (force || existsSync(resolve(nextDir, 'BUILD_ID'))) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log(
    force
      ? 'Se elimino .next antes de compilar, para no arrastrar una Full Route Cache de un despliegue anterior.'
      : 'Se descarto una compilacion de produccion previa en .next',
  );
}
