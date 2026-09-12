import { NextResponse } from 'next/server';
import { z } from 'zod';

import { apiError, assertSameOrigin, getClientIp, guardApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import {
  connectVehicleTraccarDevice,
  disconnectVehicleGpsDevice,
  getVehicleGpsDevice,
} from '@/services/fleet/vehicle-gps-device';
import { asVehicleId } from '@/types/core';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  provider: z.literal('traccar'),
  identifier: z.string().trim().min(1).max(100),
  serverUrl: z.string().trim().url().optional().or(z.literal('')),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const denied = await guardApi('flota.ver');
  if (denied) return denied;

  const { vehicleId } = await params;
  const device = await getVehicleGpsDevice(asVehicleId(vehicleId));
  return NextResponse.json({ device });
}

/** Asocia (o reemplaza) el dispositivo Traccar del vehiculo. Prueba la conexion antes de guardar. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('flota.editar');
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos de conexion GPS invalidos.' }, { status: 400 });
  }

  const { vehicleId } = await params;
  const id = asVehicleId(vehicleId);

  const result = await connectVehicleTraccarDevice(id, {
    identifier: parsed.data.identifier,
    serverUrl: parsed.data.serverUrl || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'No fue posible conectar el GPS.', test: result.test }, { status: 422 });
  }

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'vehiculo.conectar_gps',
    entity: 'vehiculos',
    entityId: id,
    detail: { proveedor: 'traccar', identificador: parsed.data.identifier },
    ip: getClientIp(request),
  });

  return NextResponse.json({ device: result.device, test: result.test });
}

/** Desconecta el GPS del vehiculo (mantiene el registro del equipo, solo rompe el vinculo). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('flota.editar');
  if (denied) return denied;

  const { vehicleId } = await params;
  const id = asVehicleId(vehicleId);
  const ok = await disconnectVehicleGpsDevice(id);
  if (!ok) return apiError('No fue posible desconectar el GPS.', 500);

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'vehiculo.desconectar_gps',
    entity: 'vehiculos',
    entityId: id,
    ip: getClientIp(request),
  });

  return new Response(null, { status: 204 });
}
