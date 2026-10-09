import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ result: vi.fn() }));
vi.mock('@/lib/supabase/server-client', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: () => ({ select: () => ({ order: db.result }) }) }),
}));
import { listVehicles } from './vehicle-store';

beforeEach(() => db.result.mockReset());

it('conserva los datos desconocidos y la asociación persistida del GPS', async () => {
  db.result.mockResolvedValue({ error: null, data: [{ id: 'truck', patente: 'RBDC59', codigo_flota: 'RBDC59',
    marca: '', modelo: '', anio: null, tipo: 'sin_dato', capacidad_litros: 0, compartimentos: 0,
    conductor_id: null, base_despacho: null, activo: true,
    dispositivos_gps: { id: 'gps', imei: '865124073408991', modelo: 'FMC130', proveedor: '3dtracking', proveedor_id_externo: 'unit' },
  }] });
  expect((await listVehicles())[0]).toMatchObject({ year: 0, type: 'sin_dato', capacityLiters: 0, compartments: 0,
    device: { imei: '865124073408991', model: 'FMC130', externalId: 'unit', provider: '3dtracking' } });
});

it('una falla de la base no se presenta como flota vacía', async () => {
  db.result.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { await expect(listVehicles()).rejects.toThrow('No fue posible consultar la flota guardada.'); }
  finally { log.mockRestore(); }
});
