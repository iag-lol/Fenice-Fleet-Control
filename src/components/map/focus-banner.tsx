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
 * La ficha siempre aisla su vehiculo. Para rutas y comunas se permite
 * alternar el aislamiento; quitar el foco vuelve a la operacion general.
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

  const label = vehiclePlate || isolate ? 'Viendo solo' : 'Seleccionado';

  return (
    <div role="status" className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-brand-200 border-l-4 border-l-brand-600 bg-white px-2.5 py-2 shadow-panel">
      <span className="text-2xs font-bold uppercase tracking-wider text-brand-900">
        <span className="min-[360px]:hidden">{vehiclePlate || isolate ? 'Solo' : 'Foco'}</span>
        <span className="hidden min-[360px]:inline">{label}</span>
      </span>

      {focos.map((foco) => (
        <span
          key={foco.id}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md bg-brand-100 py-1 pl-2 pr-1 text-xs font-semibold text-brand-900"
        >
          {foco.icono}
          <span className="numeric max-w-[9rem] truncate">{foco.texto}</span>
          {foco.subtexto ? (
            <span className="numeric shrink-0 rounded bg-white px-1 py-0.5 text-2xs text-brand-800">
              {foco.subtexto}
            </span>
          ) : null}
          <button
            type="button"
            onClick={foco.quitar}
            aria-label={`Quitar el foco en ${foco.texto}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-brand-900 hover:bg-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}

      {vehiclePlate ? (
        <span className="hidden items-center gap-1.5 px-2 text-2xs font-medium text-ink sm:inline-flex">
          <EyeOff className="h-3.5 w-3.5" /> Solo este vehículo
        </span>
      ) : <button
        type="button"
        onClick={() => setIsolate(!isolate)}
        aria-label={isolate ? `Mostrar todos (${hiddenCount} ocultos)` : 'Ver solo lo seleccionado'}
        title={
          isolate
            ? 'Mostrar tambien el resto de la operacion'
            : 'Ocultar el resto y dejar solo lo enfocado'
        }
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-brand-200 bg-brand-50 px-2 text-2xs font-semibold text-brand-900 hover:bg-brand-100 sm:min-h-7"
      >
        {isolate ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        <span className="sm:hidden">{isolate ? hiddenCount : 'Todos'}</span>
        <span className="hidden sm:inline">{isolate ? `${hiddenCount} ocultos` : 'Mostrando todos'}</span>
      </button>}
    </div>
  );
}
