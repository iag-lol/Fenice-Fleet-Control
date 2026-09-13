import type { GeofenceKind } from '@/types/core';

export const GEOFENCE_KIND_LABEL: Record<GeofenceKind, string> = {
  cliente: 'Cliente',
  centro_operacional: 'Centro operacional',
  carga: 'Zona de carga',
  descarga: 'Zona de descarga',
  zona_autorizada: 'Zona autorizada',
  zona_restringida: 'Zona restringida',
  comuna: 'Comuna',
  ruta: 'Ruta',
  personalizada: 'Personalizada',
};
