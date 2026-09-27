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
function drawTankerTruck(color: string, size = 56, frame = 0): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size * DPR;
  canvas.height = size * DPR;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No fue posible dibujar el camion cisterna.');
  ctx.scale(DPR, DPR);
  ctx.translate(size / 2, size / 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.roundRect(-12, -24, 24, 48, 7); ctx.fill();
  ctx.restore();
  // Borde de estado, legible sobre calles y fotografia satelital.
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#172334';
  ctx.fillRect(-8, -14, 16, 33);
  for (const y of [-16, 10, 17]) {
    for (const x of [-12, 8]) {
      ctx.fillStyle = '#101827'; ctx.beginPath(); ctx.roundRect(x, y, 4, 7, 1); ctx.fill();
      ctx.fillStyle = '#64748b'; ctx.fillRect(x + 0.5, y + 1 + frame % 3, 3, 1);
    }
  }
  // Cilindro metalico: volumen por reflejos, aros y tapas de inspeccion.
  const steel = ctx.createLinearGradient(-9, 0, 9, 0);
  steel.addColorStop(0, '#64748b'); steel.addColorStop(.25, '#e2e8f0');
  steel.addColorStop(.45, '#ffffff'); steel.addColorStop(.75, '#cbd5e1'); steel.addColorStop(1, '#64748b');
  ctx.fillStyle = steel; ctx.beginPath(); ctx.roundRect(-9, -7, 18, 28, 7); ctx.fill();
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
  for (const y of [-1, 7, 14]) { ctx.beginPath(); ctx.moveTo(-8, y); ctx.lineTo(8, y); ctx.stroke(); }
  ctx.fillStyle = color; ctx.fillRect(-2, -4, 4, 21);
  for (const y of [0, 9]) {
    ctx.fillStyle = '#cbd5e1'; ctx.beginPath(); ctx.ellipse(0, y, 3, 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // Cabina, parabrisas, espejos y luces delanteras.
  ctx.fillStyle = '#cf263d'; ctx.beginPath(); ctx.roundRect(-10, -23, 20, 14, 3); ctx.fill();
  ctx.fillStyle = '#172b42'; ctx.beginPath(); ctx.roundRect(-8, -21, 16, 5, 1); ctx.fill();
  ctx.fillStyle = '#94d8ed'; ctx.fillRect(-7, -20, 6, 1);
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(-8, -23, 4, 2); ctx.fillRect(4, -23, 4, 2);
  ctx.fillStyle = '#334155'; ctx.fillRect(-14, -18, 4, 2); ctx.fillRect(10, -18, 4, 2);
  ctx.fillStyle = frame % 2 ? '#fbbf24' : '#b45309';
  ctx.fillRect(-6, -13, 3, 2); ctx.fillRect(3, -13, 3, 2);
  ctx.fillStyle = '#ef4444'; ctx.fillRect(-8, 21, 4, 2); ctx.fillRect(4, 21, 4, 2);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawStoppedTanker(color: string): ImageData {
  return drawTankerTruck(color);
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

/** Pin de cliente: marcador propio con fachada comercial en su interior. */
function drawClientPin(
  color: string,
  width = 34,
  height = 44,
  selected = false,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width * DPR;
  canvas.height = height * DPR;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No fue posible crear el contexto 2D para los iconos del mapa.');

  ctx.scale(DPR, DPR);

  const cx = width / 2;
  const headRadius = selected ? 13 : 11.5;
  const cy = headRadius + 3;
  const tipY = height - 2.5;

  ctx.save();
  ctx.shadowColor = selected ? 'rgba(13, 144, 174, 0.45)' : 'rgba(15, 28, 46, 0.32)';
  ctx.shadowBlur = selected ? 8 : 5;
  ctx.shadowOffsetY = 2;

  // Silueta más geométrica que la gota genérica anterior.
  ctx.beginPath();
  ctx.arc(cx, cy, headRadius, Math.PI * 0.84, Math.PI * 0.16, false);
  ctx.quadraticCurveTo(cx + headRadius * 0.66, cy + headRadius * 1.08, cx, tipY);
  ctx.quadraticCurveTo(cx - headRadius * 0.66, cy + headRadius * 1.08, cx - headRadius * 0.82, cy + headRadius * 0.55);
  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  // Contorno blanco: separa pines contiguos del mismo estado.
  ctx.lineWidth = selected ? 3 : 2.25;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Medallon interior.
  ctx.beginPath();
  ctx.arc(cx, cy, headRadius * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Fachada comercial: toldo, cuerpo y puerta.
  const scale = selected ? 1.08 : 1;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.35;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-4.7, -2.8);
  ctx.lineTo(4.7, -2.8);
  ctx.lineTo(3.8, 0);
  ctx.lineTo(-3.8, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeRect(-3.7, 0.4, 7.4, 5);
  ctx.fillRect(-0.9, 2.2, 1.8, 3.2);
  ctx.restore();

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

type GeofencePinKind = 'central' | 'carga' | 'restringida' | 'zona';

/** Marcador de geocerca: aro territorial y pictograma según su función. */
function drawGeofencePin(kind: GeofencePinKind, color: string, size = 44): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = size * DPR;
  canvas.height = size * DPR;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No fue posible dibujar el marcador de geocerca.');
  ctx.scale(DPR, DPR);

  const center = size / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(15, 28, 46, 0.28)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(center, center, 15, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(center, center, 12.2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,255,255,.8)';
  ctx.stroke();

  ctx.save();
  ctx.translate(center, center);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (kind === 'central') {
    // Casa: identifica inmediatamente la central operacional.
    ctx.beginPath();
    ctx.moveTo(-6.5, -1);
    ctx.lineTo(0, -6.5);
    ctx.lineTo(6.5, -1);
    ctx.stroke();
    ctx.strokeRect(-5, -1, 10, 7);
    ctx.fillRect(-1.2, 2, 2.4, 4);
  } else if (kind === 'carga') {
    ctx.strokeRect(-5, -6, 7, 12);
    ctx.beginPath();
    ctx.moveTo(2, -3);
    ctx.quadraticCurveTo(7, -2, 5.5, 4.5);
    ctx.stroke();
    ctx.fillRect(-3.5, -3.5, 4, 3);
  } else if (kind === 'restringida') {
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(6, -4);
    ctx.lineTo(5, 3);
    ctx.quadraticCurveTo(0, 8, -5, 3);
    ctx.lineTo(-6, -4);
    ctx.closePath();
    ctx.stroke();
    ctx.fillRect(-0.9, -3.5, 1.8, 6);
    ctx.beginPath(); ctx.arc(0, 5, 1, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(6, -3.5);
    ctx.lineTo(6, 3.5);
    ctx.lineTo(0, 7);
    ctx.lineTo(-6, 3.5);
    ctx.lineTo(-6, -3.5);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

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
    for (let frame = 0; frame < 4; frame++) {
      const frameId = `${arrowId}-${frame}`;
      if (!map.hasImage(frameId)) map.addImage(frameId, drawTankerTruck(color, 56, frame), { pixelRatio: DPR });
    }

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
      map.addImage(selectedId, drawClientPin(color, 42, 52, true), { pixelRatio: DPR });
    }
  }

  const geofencePins: [string, GeofencePinKind, string][] = [
    ['geofence-pin-central', 'central', '#0d90ae'],
    ['geofence-pin-carga', 'carga', '#b45309'],
    ['geofence-pin-restringida', 'restringida', '#dc2626'],
    ['geofence-pin-zona', 'zona', '#475569'],
  ];
  for (const [id, kind, color] of geofencePins) {
    if (!map.hasImage(id)) map.addImage(id, drawGeofencePin(kind, color), { pixelRatio: DPR });
  }

  if (!map.hasImage('work-order-pin')) {
    map.addImage('work-order-pin', drawWorkOrderPin('#0d90ae'), { pixelRatio: DPR });
  }
  if (!map.hasImage('work-order-pin-urgent')) {
    map.addImage('work-order-pin-urgent', drawWorkOrderPin('#b45309'), { pixelRatio: DPR });
  }
}
