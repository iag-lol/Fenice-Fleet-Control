import { expect, it } from 'vitest';
import { gpsDisplayText } from './gps-branding';
it('la interfaz presenta GPS de Fleet Control y conserva el modelo e información útil', () => {
  expect(gpsDisplayText('3DTracking conectado')).toBe('GPS conectado');
  expect(gpsDisplayText('Traccar Client')).toBe('GPS');
  expect(gpsDisplayText('Movilmaster / MCI Telecom')).toBe('GPS / GPS');
  expect(gpsDisplayText('MCI')).toBe('GPS');
  expect(gpsDisplayText('Teltonika FMC130')).toBe('FMC130');
  expect(gpsDisplayText('RBDC59 · IMEI 865124073408991')).toBe('RBDC59 · IMEI 865124073408991');
});
