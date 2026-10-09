import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function worker(access = true) {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown = vi.fn(async (_title: string, _options: Record<string, unknown>) => { void _title; void _options; }); const navigate = vi.fn(async () => null); const focus = vi.fn(async () => {});
  const send = vi.fn();
  const client = { url: 'https://fleet.example.test/control', navigate, focus, postMessage: send };
  const confirm = vi.fn(async () => new Response(JSON.stringify({ preview: false, sound: true }), { status: access ? 200 : 401 }));
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
      location: { origin: 'https://fleet.example.test' }, registration: { showNotification: shown },
      clients: { matchAll: async () => [client], openWindow: vi.fn() } },
    fetch: confirm, URL, AbortController, setTimeout, clearTimeout,
  });
  const invoke = async (type: string, extra: object) => {
    let promise: Promise<unknown> | undefined;
    listeners.get(type)?.({ ...extra, waitUntil: (pending: Promise<unknown>) => { promise = pending; } });
    await promise;
  };
  return { invoke, shown, navigate, focus, confirm, send };
}
describe('push persistente compatible con navegadores moviles', () => {
  it('usa showNotification desde el trabajador, solicita sonido del sistema y confirma recepcion', async () => {
    const app = worker();
    await app.invoke('push', { data: { json: () => ({ deliveryId: 'fixture', title: 'private fixture', body: 'private content', sound: true, tag: 'fixture-alert', severity: 'critical', url: '/alertas?alerta=fixture' }) } });
    expect(app.shown).toHaveBeenCalledOnce();
    expect(app.shown.mock.calls[0]?.[0]).toBe('Fenice Fleet Control');
    expect(app.shown.mock.calls[0]?.[1]).toMatchObject({ silent: false, requireInteraction: true, renotify: false });
    expect(app.confirm).toHaveBeenCalledTimes(2); expect(app.send).toHaveBeenCalledWith({ type: 'fenice:push-received' });
  });
  it('si la sesion vencio mantiene privado el contenido del aviso', async () => {
    const app = worker(false);
    await app.invoke('push', { data: { json: () => ({ deliveryId: 'fixture', title: 'private fixture', body: 'private content', sound: false }) } });
    expect(JSON.stringify(app.shown.mock.calls)).not.toContain('private content');
    expect(app.shown.mock.calls[0]?.[1]).toMatchObject({ silent: true });
    expect(app.shown.mock.calls[0]?.[1]).not.toHaveProperty('vibrate');
  });
  it('un click nunca abre un dominio externo y espera la navegacion', async () => {
    const app = worker();
    await app.invoke('notificationclick', { notification: { close: vi.fn(), data: { url: 'https://evil.example.test/' } } });
    expect(app.navigate).toHaveBeenCalledWith('/alertas'); expect(app.focus).toHaveBeenCalledOnce();
  });
});
