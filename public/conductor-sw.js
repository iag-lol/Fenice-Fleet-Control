/**
 * Trabajador de servicio del portal del conductor.
 *
 * REGLA: solo se cachea el armazon de la aplicacion. Ninguna respuesta de
 * `/api/` se guarda. Servir datos de ruta desde cache haria que una parada
 * ya entregada apareciera como pendiente y el conductor volviera a ella.
 *
 * Lo que sostiene el trabajo sin conexion no es este cache, sino la cola de
 * entregas del propio portal: lo declarado se guarda en el telefono y se
 * envia solo al recuperar senal.
 */

const CACHE = 'fenice-conductor-v1';
const SHELL = ['/conductor.webmanifest', '/conductor-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Los datos SIEMPRE van a la red. Sin excepciones.
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && SHELL.includes(url.pathname)) {
          const copy = response.clone();
          void caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) ?? Response.error()),
  );
});
