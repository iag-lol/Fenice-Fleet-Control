import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ result: vi.fn() }));
vi.mock('@/lib/supabase/server-client', () => ({
  isSupabaseConfigured: () => true,
  getSupabaseClient: () => ({ from: () => ({ select: () => ({ order: db.result }) }) }),
}));
import { listVehicles, vehicleInputSchema, vehicleGroupInputSchema } from './vehicle-store';

beforeEach(() => db.result.mockReset());

it('conserva los datos desconocidos y la asociación persistida del GPS', async () => {
  db.result.mockResolvedValue({ error: null, data: [{ id: 'truck', patente: 'RBDC59', codigo_flota: 'RBDC59',
    marca: '', modelo: '', anio: null, tipo: 'sin_dato', grupo_vehiculo: 'personal', capacidad_litros: 0, compartimentos: 0,
    conductor_id: null, base_despacho: null, activo: true,
    dispositivos_gps: { id: 'gps', imei: '865124073408991', modelo: 'FMC130', proveedor: '3dtracking', proveedor_id_externo: 'unit' },
  }] });
  expect((await listVehicles())[0]).toMatchObject({ year: 0, type: 'sin_dato', group: 'personal', capacityLiters: 0, compartments: 0,
    device: { imei: '865124073408991', model: 'FMC130', externalId: 'unit', provider: '3dtracking' } });
});

it('registra un personal sin inventar estanques, manteniendo los requisitos para carga', () => {
  const input = { plate: 'ABCD12', fleetCode: 'P-01', type: 'personal', capacityM3: 0, compartments: 0 };
  expect(vehicleInputSchema.safeParse(input).success).toBe(true);
  expect(vehicleInputSchema.safeParse({ ...input, type: 'cisterna_rigido' }).success).toBe(false);
  expect(vehicleInputSchema.safeParse({ ...input, type: 'camioneta_estanque', capacityM3: 1, compartments: 1 }).success).toBe(true);
});

it('solo permite clasificar, sin modificar asociaciones GPS u otros campos mediante el PATCH', () => {
  expect(vehicleGroupInputSchema.safeParse({ group: 'personal' }).success).toBe(true);
  expect(vehicleGroupInputSchema.safeParse({ group: null }).success).toBe(true);
  expect(vehicleGroupInputSchema.safeParse({ group: 'administrador' }).success).toBe(false);
  expect(vehicleGroupInputSchema.safeParse({ group: 'camiones', dispositivo_id: 'otro-gps' }).success).toBe(false);
});

it('una falla de la base no se presenta como flota vacía', async () => {
  db.result.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try { await expect(listVehicles()).rejects.toThrow('No fue posible consultar la flota guardada.'); }
  finally { log.mockRestore(); }
});
