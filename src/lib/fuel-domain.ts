import type { ClientSegment, VehicleType } from '@/types/core';

/**
 * Vocabulario del dominio de distribucion de combustible.
 *
 * Vive fuera de `/demo` a proposito: son etiquetas del negocio de Fenice, no
 * datos de demostracion. Siguen siendo validas cuando la plataforma opere
 * contra la base real y el dataset de demostracion desaparezca.
 */

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  cisterna_semirremolque: 'Cisterna semirremolque',
  cisterna_rigido: 'Cisterna rigido',
  camioneta_estanque: 'Camioneta estanque',
};

export const CLIENT_SEGMENT_LABEL: Record<ClientSegment, string> = {
  estacion_servicio: 'Estacion de servicio',
  transporte: 'Transporte',
  constructora: 'Constructora',
  agricola: 'Agricola',
  industrial: 'Industrial',
  minero: 'Mineria y aridos',
  pesquera: 'Pesquera',
  generadora: 'Generadora',
};

/**
 * Densidad por defecto del diesel, en kg/L.
 *
 * Se usa como respaldo para estimar el peso de una carga cuando la fuente de
 * datos no informa la densidad del grado despachado.
 */
export const DEFAULT_FUEL_DENSITY_KG_PER_LITER = 0.84;

/** Peso de una carga de combustible, en kilogramos. */
export function litersToKilograms(liters: number, densityKgPerLiter?: number): number {
  return Math.round(liters * (densityKgPerLiter ?? DEFAULT_FUEL_DENSITY_KG_PER_LITER));
}

/**
 * Ocupacion del estanque, entre 0 y 1.
 *
 * Devuelve `null` si el vehiculo no declara capacidad: es preferible no
 * mostrar el indicador a mostrar una ocupacion inventada.
 */
export function tankUtilisation(loadedLiters: number, capacityLiters: number): number | null {
  if (!Number.isFinite(capacityLiters) || capacityLiters <= 0) return null;
  return Math.min(1, Math.max(0, loadedLiters / capacityLiters));
}
