/**
 * Trabajador de servicio de la aplicacion de operacion.
 *
 * REGLA INNEGOCIABLE: no se cachea NADA de `/api/`.
 *
 * Esta aplicacion muestra donde estan camiones cargados de combustible. Una
 * posicion servida desde cache es peor que no mostrar ninguna: el operador
 * creeria saber donde esta un vehiculo que lleva media hora en otro sitio.
 * El cache existe solo para que el armazon arranque sin conexion y explique
 * que no hay datos.
 */

const CACHE = 'fenice-app-v2';
const SHELL = ['/app.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith('fenice-app-') && key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // El portal del conductor tiene su propio trabajador con su propio alcance.
  if (url.pathname.startsWith('/conductor')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && SHELL.includes(url.pathname)) {
          const copia = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copia));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});

/** Al tocar una notificacion del sistema se abre la pantalla que la resuelve. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = safeNotificationUrl(event.notification.data?.url);

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientes) => {
      for (const cliente of clientes) {
        const url = new URL(cliente.url);
        if ('focus' in cliente && url.origin === self.location.origin && !url.pathname.startsWith('/seguimiento') && !url.pathname.startsWith('/conductor')) {
          const navigated = await cliente.navigate?.(destino);
          return (navigated ?? cliente).focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});

/** Push estandar: funciona sin una pagina ejecutando JavaScript. */
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() ?? {}; } catch { /* Aviso generico si no hay payload valido. */ }
    const confirm = async (phase) => {
      if (typeof payload.deliveryId !== 'string') return null;
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 5000);
      try {
        const response = await fetch('/api/notificaciones/recepcion', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deliveryId: payload.deliveryId, phase }),
          signal: timeout.signal,
        });
        return response.ok ? await response.json() : null;
      } catch { return null; } finally { clearTimeout(timer); }
    };
    // No mostrar datos privados si la sesion ya vencio o el equipo no pudo validarse.
    const access = await confirm('received');
    const test = payload.test === true;
    const title = test ? 'Prueba de Fenice Fleet Control' : access?.preview && typeof payload.title === 'string'
      ? payload.title.slice(0, 120) : 'Fenice Fleet Control';
    const body = test ? 'Esta es una notificación de prueba. Comprueba el aviso y el sonido de este equipo.'
      : access?.preview && typeof payload.body === 'string' ? payload.body.slice(0, 350)
      : 'Hay una actualización en el centro de alertas. Abre Fenice para revisarla.';
    const options = {
      body, icon: '/icon-192.png', badge: '/icon-192.png',
      tag: typeof payload.tag === 'string' ? payload.tag.slice(0, 240) : 'fenice-alerts',
      renotify: false, requireInteraction: payload.severity === 'critical',
      silent: access ? !access.sound : payload.sound === false,
      data: { url: safeNotificationUrl(payload.url), deliveryId: payload.deliveryId },
    };
    if (Number.isFinite(payload.timestamp)) options.timestamp = payload.timestamp;
    if (!options.silent) options.vibrate = payload.severity === 'critical' ? [200, 100, 200] : [150];
    await self.registration.showNotification(title, options);
    await confirm('shown');
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: 'fenice:push-received' });
  })());
});

function safeNotificationUrl(value) {
  try {
    const target = new URL(typeof value === 'string' ? value : '/alertas', self.location.origin);
    return target.origin === self.location.origin && target.pathname === '/alertas'
      ? target.pathname + target.search : '/alertas';
  } catch { return '/alertas'; }
}
