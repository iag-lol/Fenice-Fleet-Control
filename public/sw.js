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

const CACHE = 'fenice-app-v1';
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
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
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
  const destino = event.notification.data?.url ?? '/alertas';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
      for (const cliente of clientes) {
        if ('focus' in cliente) {
          void cliente.navigate?.(destino);
          return cliente.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
