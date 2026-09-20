/**
 * Catálogo de condiciones que reporta cada MODELO de equipo GPS.
 *
 * No es telemetría en vivo: es la ficha técnica del equipo (qué eventos es
 * capaz de detectar), igual para todos los vehículos que lleven ese mismo
 * modelo instalado. Sirve para que la operación sepa, antes de que llegue el
 * primer dato, qué va a poder ver una vez instalado el equipo.
 *
 * Se busca por inclusión (no por igualdad exacta) porque el modelo se guarda
 * como texto libre («Teltonika FMC130», «FMC130», etc.) según cómo lo cargue
 * cada integración.
 */

export interface DeviceCapabilityGroup {
  title: string;
  items: string[];
}

const FMC130_CAPABILITIES: DeviceCapabilityGroup[] = [
  {
    title: 'Conducción y comportamiento',
    items: [
      'Detección de colisiones',
      'Conducción ecológica/verde',
      'Detección de ralentí excesivo',
      'Detección de exceso de velocidad',
      'Viaje',
    ],
  },
  {
    title: 'Seguridad y equipo',
    items: [
      'Inmovilizador',
      'Detección de interferencias',
      'GSM',
      'Contador de combustible GNSS',
      'Control DOUT mediante llamada',
      'Notificación de lectura de iButton',
      'Detección de desconexión',
      'Detección de remolque',
      'Geocerca automática',
    ],
  },
];

const CAPABILITIES_BY_MODEL: { match: string; groups: DeviceCapabilityGroup[] }[] = [
  { match: 'FMC130', groups: FMC130_CAPABILITIES },
];

/** Condiciones del equipo, o `null` si el modelo no está en el catálogo. */
export function findDeviceCapabilities(model: string | null | undefined): DeviceCapabilityGroup[] | null {
  if (!model) return null;
  const normalized = model.toUpperCase();
  const entry = CAPABILITIES_BY_MODEL.find((c) => normalized.includes(c.match));
  return entry?.groups ?? null;
}
