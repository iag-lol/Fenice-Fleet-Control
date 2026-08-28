'use client';

/**
 * Aviso sonoro de las alertas.
 *
 * Se sintetiza con WebAudio en vez de cargar un archivo: no anade peso, no
 * depende de la red y suena igual sin conexion, que es justo cuando una
 * alerta importa mas.
 *
 * El tono cambia con la gravedad porque un operador que trabaja de espaldas
 * a la pantalla necesita distinguir "revisa cuando puedas" de "atiende ahora"
 * sin mirar.
 */

type Severity = 'critical' | 'warning' | 'info';

/** Frecuencias en hercios. La critica es descendente: se percibe urgente. */
const TONOS: Record<Severity, number[]> = {
  critical: [880, 660, 880],
  warning: [660, 880],
  info: [740],
};

let contexto: AudioContext | null = null;

function obtenerContexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;

  try {
    const Constructor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Constructor) return null;

    contexto ??= new Constructor();
    return contexto;
  } catch {
    // Un navegador sin audio no puede dejar la aplicacion inservible.
    return null;
  }
}

/**
 * Reproduce el aviso.
 *
 * Los navegadores bloquean el audio hasta que ha habido una interaccion del
 * usuario. Se intenta reanudar el contexto y, si no se puede, se calla sin
 * error: el aviso visual ya cumplio su funcion.
 */
export function playAlertSound(severity: Severity): void {
  const ctx = obtenerContexto();
  if (!ctx) return;

  void ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return;

  const tonos = TONOS[severity];
  const inicio = ctx.currentTime;
  const duracion = 0.14;

  tonos.forEach((frecuencia, indice) => {
    const oscilador = ctx.createOscillator();
    const ganancia = ctx.createGain();

    oscilador.type = 'sine';
    oscilador.frequency.value = frecuencia;

    const desde = inicio + indice * (duracion + 0.04);
    // Envolvente suave: un tono que arranca y corta en seco suena a fallo.
    ganancia.gain.setValueAtTime(0, desde);
    ganancia.gain.linearRampToValueAtTime(severity === 'critical' ? 0.16 : 0.1, desde + 0.02);
    ganancia.gain.exponentialRampToValueAtTime(0.0001, desde + duracion);

    oscilador.connect(ganancia).connect(ctx.destination);
    oscilador.start(desde);
    oscilador.stop(desde + duracion + 0.02);
  });
}

/**
 * Prepara el audio aprovechando una interaccion del usuario.
 *
 * Debe llamarse desde un gesto real (un clic), que es la unica forma de que
 * el navegador autorice el sonido despues.
 */
export function primeAlertSound(): void {
  const ctx = obtenerContexto();
  void ctx?.resume().catch(() => {});
}
