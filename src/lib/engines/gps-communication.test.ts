import { describe, expect, it } from 'vitest';
import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { gpsCommunication } from './gps-communication';
import { deriveVehicleStatus } from './gps-health';
import type { Position } from '@/types/core';

const gps = DEFAULT_OPERATIONAL_SETTINGS.gps;
const now = new Date('2026-10-09T15:00:00Z');
const at = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();
describe('comunicacion independiente de la posicion', () => {
  it('un heartbeat reciente no renueva la medicion ni acredita movimiento', () => {
    const position = { timestamp: at(3600), receivedAt: at(3598), speed: 0, ignition: 'off', motionEvidence: 'uncertain' } as Position;
    const result = gpsCommunication({ lastCommunicationAt: at(540) }, position, gps, now);
    expect(result.state).toBe('online');
    expect(position.timestamp).toBe(at(3600));
    expect(deriveVehicleStatus({ position, connection: 'offline', gps, communicationActive: true })).toBe('connected');
  });
  it('tolera el heartbeat de diez minutos y el margen del transporte, pero detecta su interrupcion', () => {
    expect(gpsCommunication({ lastCommunicationAt: at(620) }, null, gps, now).state).toBe('online');
    expect(gpsCommunication({ lastCommunicationAt: at(660) }, null, gps, now).state).toBe('offline');
    expect(gpsCommunication({ lastCommunicationAt: at(1000) }, null, gps, now).state).toBe('offline');
  });
  it('no convierte la hora de la consulta, una fecha corrupta o un reloj futuro en comunicacion', () => {
    expect(gpsCommunication(null, null, gps, now).state).toBe('unknown');
    expect(gpsCommunication({ lastCommunicationAt: 'bad' }, null, gps, now).state).toBe('unknown');
    expect(gpsCommunication({ lastCommunicationAt: at(-3600) }, null, gps, now).state).toBe('unknown');
  });
  it('con ultimo contacto apagado entra en espera, sin declarar que esta transmitiendo ni renovar el GPS', () => {
    const position = { timestamp: at(36000), receivedAt: at(36000), ignition: 'off', speed: 0, speedKnown: true, valid: true } as Position;
    const result = gpsCommunication({ lastCommunicationAt: at(7200) }, position, gps, now);
    expect(result.state).toBe('standby');
    expect(deriveVehicleStatus({ position, connection: 'offline', gps, communicationStandby: true })).toBe('standby');
    expect(position.timestamp).toBe(at(36000));
    expect(gpsCommunication({ lastCommunicationAt: at(86400) }, { ...position, receivedAt: at(86400) }, gps, now).state).toBe('offline');
  });
  it('una alarma de alimentacion reportada impide tratar una interrupcion como espera normal', () => {
    const position = { receivedAt: at(7200), ignition: 'off', speed: 0, speedKnown: true, valid: true,
      telemetry: { source: '3dtracking', measuredAt: at(7200), receivedAt: at(7200), externalPowerFailure: true, inputs: [], sensors: [] } } satisfies Partial<Position>;
    expect(gpsCommunication({ lastCommunicationAt: at(7200) }, position, gps, now).state).toBe('offline');
    expect(gpsCommunication({ lastCommunicationAt: at(30) }, position, gps, now).state).toBe('online');
  });
});
