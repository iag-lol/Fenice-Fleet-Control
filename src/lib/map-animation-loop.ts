/**
 * Solo mantiene RAF mientras existen posiciones que interpolar.
 *
 * `requestAnimationFrame`/`cancelAnimationFrame` son metodos nativos del
 * `window`: al guardarlos como propiedades sueltas de este objeto por
 * defecto y llamarlos como `scheduler.request(...)`, el navegador los invoca
 * con `this` igual a `scheduler` en vez de `window` y lanza
 * `TypeError: Illegal invocation` (rompia el mapa completo, capturado por su
 * ErrorBoundary). Envueltos en funciones flecha se invocan como identificador
 * global suelto, que es como esas APIs esperan que se las llame.
 */
export function startMapAnimationLoop(
  draw: (timestamp: number) => boolean,
  scheduler = {
    request: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
    cancel: (handle: number) => cancelAnimationFrame(handle),
  },
): () => void {
  const interval = 1000 / 30;
  let lastDraw = -Infinity;
  let stopped = false;
  let frame: number | null = null;

  const step = (timestamp: number): void => {
    frame = null;
    if (stopped) return;
    if (timestamp - lastDraw + 0.01 >= interval) {
      lastDraw = timestamp;
      if (!draw(timestamp)) return;
    }
    frame = scheduler.request(step);
  };

  frame = scheduler.request(step);
  return () => {
    stopped = true;
    if (frame !== null) scheduler.cancel(frame);
    frame = null;
  };
}
