'use client';

/**
 * Compresion de la fotografia ANTES de enviarla.
 *
 * Una foto de un telefono actual pesa entre 3 y 8 MB. Subirla tal cual por
 * una red movil en un patio industrial no termina nunca y consume los datos
 * del conductor. Se reduce a un lado maximo de 1280 px y calidad JPEG 0,72:
 * suficiente para leer un totalizador, una guia o el estado de un estanque,
 * y unas veinte veces mas liviana.
 *
 * Se hace en el telefono y no en el servidor porque el cuello de botella es
 * justamente la subida.
 */

const MAX_EDGE = 1280;
const QUALITY = 0.72;
/** Por debajo de esta calidad la foto deja de servir como evidencia. */
const MIN_QUALITY = 0.45;

export interface CapturedPhoto {
  dataUrl: string;
  byteSize: number;
  width: number;
  height: number;
  capturedAt: string;
}

function estimateBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  return Math.floor((dataUrl.length - comma - 1) * 0.75);
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('No pudimos leer la imagen.'));
      image.src = url;
    });
  } finally {
    // Liberar siempre: en una jornada de veinte paradas, no hacerlo mantiene
    // decenas de megabytes vivos en un telefono que ya va justo de memoria.
    URL.revokeObjectURL(url);
  }
}

export async function compressPhoto(file: File, maxBytes: number): Promise<CapturedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('El archivo seleccionado no es una imagen.');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Este telefono no permite procesar la imagen.');

  context.drawImage(image, 0, 0, width, height);

  let quality = QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Si aun asi excede el limite, se baja la calidad por pasos. Se prefiere
  // perder nitidez a rechazar la evidencia con el cliente delante.
  while (estimateBytes(dataUrl) > maxBytes && quality > MIN_QUALITY) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  if (estimateBytes(dataUrl) > maxBytes) {
    throw new Error('La fotografia es demasiado grande. Intenta con menos detalle.');
  }

  return {
    dataUrl,
    byteSize: estimateBytes(dataUrl),
    width,
    height,
    capturedAt: new Date().toISOString(),
  };
}

export interface CapturedPosition {
  coordinates: { lat: number; lng: number } | null;
  accuracyMeters: number | null;
  error: string | null;
}

/**
 * Posicion del TELEFONO al firmar.
 *
 * Es independiente del GPS del camion y sirve para contrastar: si el telefono
 * dice estar a dos kilometros del domicilio, la entrega merece revision. No
 * se bloquea la entrega por ello — el GPS del telefono falla dentro de naves
 * y bajo estructuras metalicas — pero queda registrado.
 */
export async function capturePosition(timeoutMs = 8000): Promise<CapturedPosition> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { coordinates: null, accuracyMeters: null, error: 'Este equipo no entrega ubicacion.' };
  }

  return new Promise<CapturedPosition>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          coordinates: { lat: position.coords.latitude, lng: position.coords.longitude },
          accuracyMeters: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
          error: null,
        }),
      (error) =>
        resolve({
          coordinates: null,
          accuracyMeters: null,
          error:
            error.code === error.PERMISSION_DENIED
              ? 'Ubicacion desactivada para esta pagina.'
              : 'No pudimos obtener la ubicacion.',
        }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}
