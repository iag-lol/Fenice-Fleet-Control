import { describe, expect, it } from 'vitest';
import { notificationPayload, deliveryOutcome, type PushJob } from './push-dispatcher';
import { isTrustedPushEndpoint } from './push-schema';
const job = { id: 'fixture-job', tipo: 'alerta', alerta_id: 'fixture-alert', revision: 1, severidad: 'critical',
  mostrar_detalle: false, sonido: true, titulo: 'Private receiver fixture', descripcion: 'Private location fixture', marca_tiempo: '2026-10-09T08:00:00Z' } as PushJob;
describe('notificaciones seguras y recuperables', () => {
  it('protege el contenido de la pantalla bloqueada salvo que se autorice detalle', () => {
    const payload = notificationPayload(job);
    expect(JSON.stringify(payload)).not.toContain('Private receiver'); expect(JSON.stringify(payload)).not.toContain('Private location');
    expect(notificationPayload({ ...job, mostrar_detalle: true })).toMatchObject({ title: job.titulo, body: job.descripcion });
  });
  it('una prueba no se confunde con una alerta real de un camion', () => {
    expect(notificationPayload({ ...job, tipo: 'prueba', alerta_id: null })).toMatchObject({ test: true, title: 'Prueba de Fenice Fleet Control', url: '/alertas' });
  });
  it.each([404, 410])('desactiva solo suscripciones expiradas con HTTP %s', status => { expect(deliveryOutcome(status, 1)).toMatchObject({ state: 'cancelada', disable: true }); });
  it.each([null, 429, 500, 503])('reintenta fallos temporales %s de forma acotada', status => {
    expect(deliveryOutcome(status, 1)).toMatchObject({ state: 'pendiente', disable: false });
    expect(deliveryOutcome(status, 6)).toMatchObject({ state: 'fallida', disable: false });
  });
  it('no reintenta errores permanentes ni declara entrega con un fallo', () => {
    expect(deliveryOutcome(400, 1).state).toBe('fallida'); expect(deliveryOutcome(201, 1).state).toBe('enviada');
  });
  it.each(['http://127.0.0.1', 'https://169.254.169.254', 'https://fcm.googleapis.com.evil.test/', 'https://evil.test/push.apple.com', 'https://user:secret@fcm.googleapis.com/', 'https://fcm.googleapis.com:444/'])('rechaza endpoint SSRF %s', endpoint => { expect(isTrustedPushEndpoint(endpoint)).toBe(false); });
  it.each(['https://fcm.googleapis.com/wp/fixture', 'https://web.push.apple.com/fixture', 'https://updates.push.services.mozilla.com/wpush/v2/fixture', 'https://wns2-fixture.notify.windows.com/w/?token=fixture'])('permite el servicio push oficial %s', endpoint => { expect(isTrustedPushEndpoint(endpoint)).toBe(true); });
});
