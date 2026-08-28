import type { Map as MapLibreMap } from 'maplibre-gl';

import { ACTIVITY_COLOR } from '@/lib/engines/vehicle-activity';

/**
 * Iconos generados en tiempo de ejecucion.
 *
 * Se dibujan en canvas y se registran como imagenes del mapa en vez de cargar
 * archivos: evita peticiones adicionales, mantiene el color sincronizado con
 * los tokens del sistema y permite generar una variante por estado sin
 * multiplicar recursos estaticos.
 */

const DPR = 2;

/**
 * Camion cisterna visto en planta, orientado hacia arriba.
 *
 * No es un pin generico ni una flecha: se dibuja la silueta de un camion
 * cisterna (cabina + estanque cilindrico) para que el operador distinga de un
 * vistazo un vehiculo de un cliente o de una parada. El layer lo rota segun el
 * rumbo del GPS, de modo que la punta senala siempre hacia donde avanza.
 */
function drawTankerTruck(color: string, size = 44): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size * DPR;
  canvas.height = size * DPR;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No fue posible crear el contexto 2D para los iconos del mapa.');

  ctx.scale(DPR, DPR);
  const cx = size / 2;
  const cy = size / 2;

  // Disco de fondo: mantiene legible el camion sobre cualquier basemap y da
  // un area de pulsacion generosa.
  ctx.save();
  ctx.shadowColor = 'rgba(15, 28, 46, 0.4)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.save();
  ctx.translate(cx, cy);

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Cabina: trapecio en el frente del vehiculo.
  ctx.beginPath();
  ctx.moveTo(0, -8.6);
  ctx.lineTo(3.4, -5.6);
  ctx.lineTo(3.4, -2.6);
  ctx.lineTo(-3.4, -2.6);
  ctx.lineTo(-3.4, -5.6);
  ctx.closePath();
  ctx.fill();

  // Estanque cilindrico: el cuerpo del cisterna.
  ctx.beginPath();
  ctx.roundRect(-3.9, -1.6, 7.8, 9.4, 2.4);
  ctx.fill();

  // Separaciones de los compartimentos.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.9;
  for (const y of [1.4, 4.2]) {
    ctx.beginPath();
    ctx.moveTo(-3.2, y);
    ctx.lineTo(3.2, y);
    ctx.stroke();
  }

  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Camion detenido.
 *
 * Es la misma silueta de cisterna: un camion debe verse como camion aunque
 * este parado. Lo que cambia es que el layer no lo rota, porque el rumbo de
 * un vehiculo detenido es el ultimo que registro y orientarlo por el
 * confundiria mas de lo que informa.
 */
function drawStoppedTanker(color: string, size = 44): ImageData {
  return drawTankerTruck(color, size);
}

/** Pin de orden de trabajo pendiente: forma distinta a clientes y camiones. */
function drawWorkOrderPin(color: string, size = 34): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size * DPR;
  canvas.height = size * DPR;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No fue posible crear el contexto 2D para los iconos del mapa.');

  ctx.scale(DPR, DPR);
  const center = size / 2;

  ctx.save();
  ctx.shadowColor = 'rgba(15, 28, 46, 0.3)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  ctx.moveTo(center, center - 8);
  ctx.lineTo(center + 8, center);
  ctx.lineTo(center, center + 8);
  ctx.lineTo(center - 8, center);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.lineWidth = 2.2;
  ctx.strokeStyle = color;
  ctx.stroke();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Pin de cliente: gota clasica de mapa, anclada por la punta.
 *
 * Se usa forma de pin y no un circulo para que el cliente se distinga de un
 * vistazo del vehiculo (disco con flecha) y de la parada de ruta (circulo
 * numerado), incluso cuando los tres coinciden en la misma manzana.
 */
function drawClientPin(color: string, width = 30, height = 40): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width * DPR;
  canvas.height = height * DPR;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No fue posible crear el contexto 2D para los iconos del mapa.');

  ctx.scale(DPR, DPR);

  const cx = width / 2;
  const headRadius = 10;
  const cy = headRadius + 2;
  const tipY = height - 3;

  ctx.save();
  ctx.shadowColor = 'rgba(15, 28, 46, 0.35)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1.5;

  // Cuerpo de la gota: circulo superior que se cierra en punta hacia abajo.
  ctx.beginPath();
  ctx.arc(cx, cy, headRadius, Math.PI * 0.82, Math.PI * 0.18, false);
  ctx.quadraticCurveTo(cx + headRadius * 0.62, cy + headRadius * 1.1, cx, tipY);
  ctx.quadraticCurveTo(cx - headRadius * 0.62, cy + headRadius * 1.1, cx - headRadius * 0.79, cy + headRadius * 0.6);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // Contorno blanco: separa pines contiguos del mismo estado.
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Ojo interior.
  ctx.beginPath();
  ctx.arc(cx, cy, 3.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Colores de estado comercial del cliente. */
export const CLIENT_PIN_COLORS: Record<string, string> = {
  active: '#15803d',
  warning: '#b45309',
  dormant: '#dc2626',
};

/**
 * Colores del marcador segun el estado de ACTIVIDAD del vehiculo.
 *
 * Se importan del motor para que exista una sola definicion: el color del
 * camion en el mapa y el de su distintivo en las tablas no pueden divergir.
 */
export const VEHICLE_ICON_COLORS: Record<string, string> = ACTIVITY_COLOR;

/** Registra todos los iconos. Idempotente: seguro tras un cambio de estilo. */
export function registerMapIcons(map: MapLibreMap): void {
  for (const [status, color] of Object.entries(VEHICLE_ICON_COLORS)) {
    const arrowId = `vehicle-arrow-${status}`;
    const dotId = `vehicle-dot-${status}`;

    if (!map.hasImage(arrowId)) {
      map.addImage(arrowId, drawTankerTruck(color), { pixelRatio: DPR });
    }
    if (!map.hasImage(dotId)) {
      map.addImage(dotId, drawStoppedTanker(color), { pixelRatio: DPR });
    }
  }

  for (const [status, color] of Object.entries(CLIENT_PIN_COLORS)) {
    const id = `client-pin-${status}`;
    if (!map.hasImage(id)) {
      map.addImage(id, drawClientPin(color), { pixelRatio: DPR });
    }
    // Variante destacada para el cliente seleccionado.
    const selectedId = `client-pin-${status}-selected`;
    if (!map.hasImage(selectedId)) {
      map.addImage(selectedId, drawClientPin(color, 38, 50), { pixelRatio: DPR });
    }
  }

  if (!map.hasImage('work-order-pin')) {
    map.addImage('work-order-pin', drawWorkOrderPin('#0d90ae'), { pixelRatio: DPR });
  }
  if (!map.hasImage('work-order-pin-urgent')) {
    map.addImage('work-order-pin-urgent', drawWorkOrderPin('#b45309'), { pixelRatio: DPR });
  }
}
