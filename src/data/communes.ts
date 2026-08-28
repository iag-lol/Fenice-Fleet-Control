/**
 * Comunas del area de operacion.
 *
 * Reexporta el proveedor de limites administrativos oficiales. Se conserva
 * este modulo como punto de acceso estable para que el resto de la plataforma
 * no dependa de donde vive la cartografia: cambiar de fuente (IDE Chile,
 * vector tiles, PostGIS) es cambiar `administrative-boundaries.ts`.
 */

export {
  BOUNDARY_METADATA,
  COMMUNES,
  getCommune,
  getCommuneForPoint,
  getCommuneName,
  OPERATION_BOUNDS,
  OPERATION_CENTER,
  type BoundaryMetadata,
} from '@/data/administrative-boundaries';
