'use client';

import { Eye, EyeOff, MapPin, Route as RouteIcon, Truck, X } from 'lucide-react';

import { useMapStore } from '@/stores/map-store';

/**
 * Que se esta mirando ahora mismo, y como salir de ahi.
 *
 * Cuando el mapa se concentra en un camion, una ruta o una comuna, el resto
 * desaparece. Esa desaparicion tiene que ser SIEMPRE explicita: sin este
 * aviso, un operador que no recuerda haber seleccionado nada creeria que se
 * quedo sin datos.
 *
 * Por eso el aviso dice tres cosas: en que esta enfocado, que puede apagar
 * el aislamiento sin perder la seleccion, y como quitar el foco del todo.
 */

export interface FocusBannerProps {
  vehiclePlate: string | null;
  /** Codigo interno de flota del vehiculo enfocado, ej. "C-104". */
  vehicleFleetCode?: string | null;
  routeCode: string | null;
  communeName: string | null;
  /** Cuantas entidades quedan ocultas por el enfoque. */
  hiddenCount: number;
  onClearVehicle: () => void;
  onClearRoute: () => void;
  onClearCommune: () => void;
}

export function FocusBanner({
  vehiclePlate,
  vehicleFleetCode,
  routeCode,
  communeName,
  hiddenCount,
  onClearVehicle,
  onClearRoute,
  onClearCommune,
}: FocusBannerProps) {
  const isolate = useMapStore((s) => s.isolate);
  const setIsolate = useMapStore((s) => s.setIsolate);

  const focos = [
    vehiclePlate
      ? {
          id: 'vehiculo',
          icono: <Truck className="h-3.5 w-3.5" />,
          texto: vehiclePlate,
          subtexto: vehicleFleetCode ?? null,
          quitar: onClearVehicle,
        }
      : null,
    routeCode
      ? { id: 'ruta', icono: <RouteIcon className="h-3.5 w-3.5" />, texto: routeCode, subtexto: null, quitar: onClearRoute }
      : null,
    communeName
      ? { id: 'comuna', icono: <MapPin className="h-3.5 w-3.5" />, texto: communeName, subtexto: null, quitar: onClearCommune }
      : null,
  ].filter((f) => f !== null);

  if (focos.length === 0) return null;

  // Cuando lo unico enfocado es UN vehiculo (el caso mas frecuente), el
  // rotulo lo nombra explicitamente en vez del generico "Seleccionado":
  // es la frase que pide la operacion ("1 vehiculo seleccionado").
  const label =
    focos.length === 1 && focos[0]?.id === 'vehiculo' && !isolate
      ? '1 vehículo seleccionado'
      : isolate
        ? 'Viendo solo'
        : 'Seleccionado';

  return (
    <div className="pointer-events-auto flex max-w-[calc(100vw-1.25rem)] flex-wrap items-center gap-2 rounded-lg border border-brand-500/45 bg-surface-900/96 px-2.5 py-2 shadow-float backdrop-blur">
      <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">{label}</span>

      {focos.map((foco) => (
        <span
          key={foco.id}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-500/12 py-1 pl-2 pr-1 text-xs font-medium text-brand-700"
        >
          {foco.icono}
          <span className="numeric max-w-[9rem] truncate">{foco.texto}</span>
          {foco.subtexto ? (
            <span className="numeric shrink-0 rounded bg-surface-900/60 px-1 py-0.5 text-2xs text-brand-700/80">
              {foco.subtexto}
            </span>
          ) : null}
          <button
            type="button"
            onClick={foco.quitar}
            aria-label={`Quitar el foco en ${foco.texto}`}
            className="flex h-6 w-6 items-center justify-center rounded text-brand-700/70 hover:bg-surface-800 hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}

      <button
        type="button"
        onClick={() => setIsolate(!isolate)}
        title={
          isolate
            ? 'Mostrar tambien el resto de la operacion'
            : 'Ocultar el resto y dejar solo lo enfocado'
        }
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line-strong px-2 text-2xs font-medium text-ink-muted hover:text-ink sm:min-h-7"
      >
        {isolate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        {isolate ? `${hiddenCount} ocultos` : 'Mostrando todos'}
      </button>
    </div>
  );
}
