import type { Vehicle, VehicleGroup } from '@/types/core';

export const VEHICLE_GROUPS = ['camiones', 'camionetas', 'personal'] as const;
export type VehicleGroupFilter = 'todos' | 'carga' | VehicleGroup | 'sin_grupo';
export const VEHICLE_GROUP_LABEL = { camiones: 'Camiones', camionetas: 'Camionetas', personal: 'Personal', sin_grupo: 'Sin grupo' } as const;
export const VEHICLE_GROUP_FILTER_OPTIONS: { value: VehicleGroupFilter; label: string }[] = [
  { value: 'todos', label: 'Todos los grupos' },
  { value: 'carga', label: 'Carga de combustible' },
  ...VEHICLE_GROUPS.map(value => ({ value, label: VEHICLE_GROUP_LABEL[value] })),
  { value: 'sin_grupo', label: 'Sin grupo' },
];

/** La clasificación manual prevalece; unidades sin tipo no se inventan como camiones. */
export function vehicleGroup(vehicle: Pick<Vehicle, 'type' | 'group'>): VehicleGroup | 'sin_grupo' {
  if (vehicle.group !== undefined) return vehicle.group ?? 'sin_grupo';
  if (vehicle.type === 'camioneta_estanque') return 'camionetas';
  if (vehicle.type === 'personal') return 'personal';
  if (vehicle.type === 'cisterna_rigido' || vehicle.type === 'cisterna_semirremolque') return 'camiones';
  return 'sin_grupo';
}

export function matchesVehicleGroup(vehicle: Pick<Vehicle, 'type' | 'group'>, filter: VehicleGroupFilter): boolean {
  const group = vehicleGroup(vehicle);
  return filter === 'todos' || (filter === 'carga' ? group === 'camiones' || group === 'camionetas' : group === filter);
}
