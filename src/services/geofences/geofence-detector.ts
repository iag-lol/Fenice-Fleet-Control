import 'server-only';

import { containsPoint, distanceToCenter, resolveGeofenceAlertDecision } from '@/lib/engines/geofence-engine';
import { createAlert } from '@/services/fleet/alert-store';
import { recordGeofenceEvent } from '@/services/fleet/geofence-event-store';
import { listGeofences } from '@/services/geofences/geofence-store';
import type { GpsProvider, PositionSubscriptionHandlers, Unsubscribe } from '@/services/gps/gps-provider';
import type { Geofence, LatLng, Position, VehicleId } from '@/types/core';

/**
 * Evalua cada posicion nueva contra las geocercas activas y genera el evento
 * (`eventos_geocerca`) y, segun las reglas de la geocerca, la alerta
 * correspondiente.
 *
 * Existia el motor de calculo puro (`geofence-engine.ts`,
 * `scanTrackForGeofenceEvents`) pero nunca estuvo conectado a un flujo real:
 * el propio codigo lo documentaba como "fuera del alcance de esta entrega".
 * Este modulo es esa conexion, envolviendo el proveedor GPS igual que
 * `traccar-device-links-provider.ts`, para que aplique sin importar cual sea
 * el proveedor activo (Traccar, 3DTracking, vinculos manuales...).
 *
 * Deduplicacion: el estado "dentro/fuera" por vehiculo+geocerca vive en un
 * Map a nivel de proceso (no por conexion SSE), y un debounce evita re-evaluar
 * el mismo lote de posiciones mas de una vez por segundo aunque haya varias
 * pestañas con el mapa abierto disparando el chequeo en paralelo.
 */

const insideState = new Map<string, boolean>();
let lastProcessedAt = 0;
const MIN_PROCESS_INTERVAL_MS = 4_000;

function insideKey(vehicleId: VehicleId, geofenceId: string): string {
  return `${vehicleId}::${geofenceId}`;
}

async function evaluateOne(position: Position, geofence: Geofence): Promise<void> {
  if (!geofence.active) return;
  // Geocercas ligadas a un vehiculo especifico solo aplican a ese vehiculo.
  if (geofence.vehicleId && geofence.vehicleId !== position.vehicleId) return;

  const point: LatLng = { lat: position.lat, lng: position.lng };
  const key = insideKey(position.vehicleId, geofence.id);
  const wasInside = insideState.get(key) ?? false;
  const isInside = containsPoint(geofence, point);
  if (wasInside === isInside) return;
  insideState.set(key, isInside);

  const type: 'enter' | 'exit' = isInside ? 'enter' : 'exit';
  const distanceMeters = Math.round(distanceToCenter(geofence, point));

  // El hecho se registra siempre que hay una transicion real: es el
  // historial, independiente de si la regla pide alertar por ella.
  await recordGeofenceEvent({
    geofenceId: geofence.id,
    vehicleId: position.vehicleId,
    type,
    timestamp: position.timestamp,
    position: point,
    distanceMeters,
  });

  const decision = resolveGeofenceAlertDecision(
    geofence,
    type,
    position.vehicleId,
    new Date(position.timestamp),
  );
  if (!decision) return;

  await createAlert({
    id: `geocerca-${type}:${geofence.id}:${position.vehicleId}:${position.timestamp}`,
    type: decision.alertType,
    category: 'geocerca',
    severity: decision.severity,
    title: decision.title,
    description: `${geofence.name} · a ${distanceMeters} m del centro.`,
    timestamp: position.timestamp,
    vehicleId: position.vehicleId,
    position: point,
  });
}

function processPositions(positions: Position[]): void {
  if (positions.length === 0) return;

  const now = Date.now();
  if (now - lastProcessedAt < MIN_PROCESS_INTERVAL_MS) return;
  lastProcessedAt = now;

  void (async () => {
    try {
      const geofences = await listGeofences();
      const active = geofences.filter((g) => g.active);
      if (active.length === 0) return;

      for (const position of positions) {
        for (const geofence of active) {
          await evaluateOne(position, geofence);
        }
      }
    } catch (error) {
      console.error(
        '[geofence-detector] fallo al procesar posiciones:',
        error instanceof Error ? error.message : String(error),
      );
    }
  })();
}

/** Envuelve cualquier GpsProvider para evaluar sus posiciones contra las geocercas activas. */
export function withGeofenceDetection(base: GpsProvider): GpsProvider {
  return {
    info: base.info,
    getVehicles: () => base.getVehicles(),
    getVehiclePosition: (vehicleId) => base.getVehiclePosition(vehicleId),

    async getAllCurrentPositions() {
      const positions = await base.getAllCurrentPositions();
      processPositions(positions);
      return positions;
    },

    getPositionHistory: (query) => base.getPositionHistory(query),
    getVehicleEvents: (query) => base.getVehicleEvents(query),
    getDeviceStatus: (vehicleId) => base.getDeviceStatus(vehicleId),

    subscribeToPositions(handlers: PositionSubscriptionHandlers): Unsubscribe {
      return base.subscribeToPositions({
        ...handlers,
        onPositions: (positions) => {
          processPositions(positions);
          handlers.onPositions(positions);
        },
      });
    },

    healthCheck: base.healthCheck?.bind(base),
  };
}
