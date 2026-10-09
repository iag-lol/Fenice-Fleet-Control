import { describe, expect, it } from 'vitest';
import { newRelevantAlerts, alertRevisionKey, parseNotificationPreferences } from './notification-client';
import type { Alert } from '@/types/core';
const alert = { id: 'fixture', state: 'nueva', severity: 'warning', notificationRevision: 1 } as Alert;
describe('alertas en vivo sin duplicaciones ni eventos historicos al ingresar', () => {
  it('la primera instantanea no anuncia todas las alertas antiguas', () => { expect(newRelevantAlerts([alert], null, 'info')).toEqual([]); });
  it('avisa una sola vez y vuelve a avisar al elevar la gravedad o reabrir', () => {
    const known = new Map([[alert.id, alertRevisionKey(alert)]]);
    expect(newRelevantAlerts([alert], known, 'info')).toEqual([]);
    const elevated = { ...alert, severity: 'critical' as const, notificationRevision: 2 };
    expect(newRelevantAlerts([elevated], known, 'info')).toEqual([elevated]);
  });
  it('nunca notifica alertas resueltas o revisadas y respeta el filtro', () => {
    expect(newRelevantAlerts([{ ...alert, state: 'resuelta' }], new Map(), 'info')).toEqual([]);
    expect(newRelevantAlerts([{ ...alert, state: 'revisada' }], new Map(), 'info')).toEqual([]);
    expect(newRelevantAlerts([alert], new Map(), 'critical')).toEqual([]);
  });
  it('preferencias corruptas no activan avisos ni revelan datos por defecto', () => {
    expect(parseNotificationPreferences('{broken')).toMatchObject({ desktop: false, preview: false, minSeverity: 'info' });
    expect(parseNotificationPreferences('{"desktop":"yes","preview":"yes","minSeverity":"admin"}')).toMatchObject({ desktop: false, preview: false, minSeverity: 'info' });
  });
});
