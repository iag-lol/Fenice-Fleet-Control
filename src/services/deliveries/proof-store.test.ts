import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearProofs,
  deliveryProofInputSchema,
  getProof,
  listProofs,
  recordDeliveryProof,
} from './proof-store';
import type { LatLng, RouteId, VehicleId, WorkOrderId } from '@/types/core';

const OT = 'wo-1' as WorkOrderId;
const RUTA = 'route-1' as RouteId;
const DOMICILIO: LatLng = { lat: -33.45, lng: -70.66 };

const FOTO = {
  dataUrl: `data:image/jpeg;base64,${'A'.repeat(400)}`,
  byteSize: 300,
  width: 1280,
  height: 960,
  capturedAt: '2026-08-27T14:00:00.000Z',
};

const CONTEXTO = {
  workOrderId: OT,
  routeId: RUTA,
  driverId: null,
  vehicleId: 'veh-1' as VehicleId,
  clientCoordinates: DOMICILIO,
};

function entregaValida(overrides: Record<string, unknown> = {}) {
  return deliveryProofInputSchema.parse({
    outcome: 'entregada',
    receiverName: 'Patricia Soto',
    deliveredLiters: 4800,
    photos: [FOTO],
    declaredAt: '2026-08-27T14:01:00.000Z',
    ...overrides,
  });
}

describe('evidencia de entrega', () => {
  beforeEach(() => clearProofs());

  it('exige quien recibe cuando la parada se declara entregada', () => {
    const parsed = deliveryProofInputSchema.safeParse({
      outcome: 'entregada',
      declaredAt: '2026-08-27T14:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.includes('receiverName'))).toBe(true);
  });

  it('exige motivo cuando la parada se declara incidencia', () => {
    const parsed = deliveryProofInputSchema.safeParse({
      outcome: 'incidencia',
      declaredAt: '2026-08-27T14:00:00.000Z',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.some((i) => i.path.includes('incidentReason'))).toBe(true);
  });

  it('rechaza una fotografia que no venga codificada como imagen', () => {
    const parsed = deliveryProofInputSchema.safeParse({
      outcome: 'entregada',
      receiverName: 'Patricia Soto',
      declaredAt: '2026-08-27T14:00:00.000Z',
      photos: [{ ...FOTO, dataUrl: 'https://ejemplo.cl/foto.jpg' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('registra la evidencia y calcula la distancia al domicilio', () => {
    const result = recordDeliveryProof(
      entregaValida({ capturedPosition: { lat: -33.4505, lng: -70.66 } }),
      CONTEXTO,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(false);
    expect(result.proof.receiverName).toBe('Patricia Soto');
    expect(result.proof.photos).toHaveLength(1);
    expect(result.proof.photos[0]?.id).toBeTruthy();
    // ~55 m entre el punto de firma y el domicilio declarado.
    expect(result.proof.distanceToClientMeters).toBeGreaterThan(40);
    expect(result.proof.distanceToClientMeters).toBeLessThan(70);
  });

  it('es idempotente: reenviar la misma evidencia no crea una segunda', () => {
    const primera = recordDeliveryProof(entregaValida(), CONTEXTO);
    const segunda = recordDeliveryProof(entregaValida({ receiverName: 'Otro Nombre' }), CONTEXTO);

    expect(primera.ok && segunda.ok).toBe(true);
    if (!primera.ok || !segunda.ok) return;
    expect(segunda.duplicate).toBe(true);
    expect(segunda.proof.id).toBe(primera.proof.id);
    // La primera declaracion es la que vale: el reenvio no la reescribe.
    expect(getProof(OT)?.receiverName).toBe('Patricia Soto');
    expect(listProofs()).toHaveLength(1);
  });

  it('rechaza una fotografia que supera el limite aunque mienta en su tamano', () => {
    const enorme = { ...FOTO, byteSize: 10, dataUrl: `data:image/jpeg;base64,${'A'.repeat(4_000_000)}` };
    const result = recordDeliveryProof(entregaValida({ photos: [enorme] }), CONTEXTO);

    expect(result.ok).toBe(false);
    expect(getProof(OT)).toBeNull();
  });

  it('conserva la hora declarada en terreno y la de recepcion cuando llega desde la cola', () => {
    const result = recordDeliveryProof(
      entregaValida({ declaredAt: '2026-08-27T14:01:00.000Z', submittedOffline: true }),
      { ...CONTEXTO, now: new Date('2026-08-27T15:40:00.000Z') },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proof.declaredAt).toBe('2026-08-27T14:01:00.000Z');
    expect(result.proof.receivedAt).toBe('2026-08-27T15:40:00.000Z');
    expect(result.proof.submittedOffline).toBe(true);
  });

  it('filtra el listado por ruta y por resultado', () => {
    recordDeliveryProof(entregaValida(), CONTEXTO);
    recordDeliveryProof(
      deliveryProofInputSchema.parse({
        outcome: 'incidencia',
        incidentReason: 'cliente_ausente',
        declaredAt: '2026-08-27T15:00:00.000Z',
      }),
      { ...CONTEXTO, workOrderId: 'wo-2' as WorkOrderId },
    );

    expect(listProofs({ routeId: RUTA })).toHaveLength(2);
    expect(listProofs({ outcome: 'incidencia' })).toHaveLength(1);
    expect(listProofs({ withPhotosOnly: true })).toHaveLength(1);
    // Mas reciente primero.
    expect(listProofs()[0]?.outcome).toBe('incidencia');
  });
});
