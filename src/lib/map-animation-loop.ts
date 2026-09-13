/** Solo mantiene RAF mientras existen posiciones que interpolar. */
export function startMapAnimationLoop(
  draw: (timestamp: number) => boolean,
  scheduler = { request: requestAnimationFrame, cancel: cancelAnimationFrame },
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
