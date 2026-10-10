import { describe, expect, it } from 'vitest';
import { matchesVehicleGroup, vehicleGroup } from './vehicle-groups';

describe('grupos de flota', () => {
  it('carga incluye ambos tipos de camion y camionetas, sin incluir personales ni desconocidos', () => {
    expect(matchesVehicleGroup({ type: 'cisterna_semirremolque' }, 'carga')).toBe(true);
    expect(matchesVehicleGroup({ type: 'cisterna_rigido' }, 'carga')).toBe(true);
    expect(matchesVehicleGroup({ type: 'camioneta_estanque' }, 'carga')).toBe(true);
    expect(matchesVehicleGroup({ type: 'personal' }, 'carga')).toBe(false);
    expect(matchesVehicleGroup({ type: 'sin_dato' }, 'carga')).toBe(false);
  });
  it('respeta la clasificacion manual aunque el tipo tecnico o el catalogo cambien', () => {
    expect(vehicleGroup({ type: 'camioneta_estanque', group: 'personal' })).toBe('personal');
    expect(matchesVehicleGroup({ type: 'sin_dato', group: 'camiones' }, 'carga')).toBe(true);
    expect(matchesVehicleGroup({ type: 'cisterna_rigido', group: null }, 'sin_grupo')).toBe(true);
  });
  it('todos mantiene unidades sin clasificar y cada grupo excluye los otros', () => {
    expect(matchesVehicleGroup({ type: 'sin_dato' }, 'todos')).toBe(true);
    expect(matchesVehicleGroup({ type: 'camioneta_estanque' }, 'camiones')).toBe(false);
    expect(matchesVehicleGroup({ type: 'personal' }, 'personal')).toBe(true);
  });
});
