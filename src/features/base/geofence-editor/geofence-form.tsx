'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { NumberField, Input, Select, Toggle } from '@/components/ui/input';
import { GEOFENCE_RADIUS_PRESETS } from '@/config/operational';
import { cn } from '@/lib/cn';
import {
  DEFAULT_GEOFENCE_RULES,
  type Geofence,
  type GeofenceGeometry,
  type GeofenceKind,
  type GeofenceRules,
  type GeofenceTrigger,
} from '@/types/core';

/**
 * Formulario de propiedades y reglas de una geocerca.
 *
 * La pregunta central no es "que forma tiene" sino "que quiere detectar":
 * una geocerca sin reglas es solo un dibujo. Por eso los disparadores ocupan
 * un lugar tan visible como el nombre.
 */

export const GEOFENCE_KIND_LABEL: Record<GeofenceKind, string> = {
  cliente: 'Cliente',
  centro_operacional: 'Centro operacional',
  carga: 'Zona de carga',
  descarga: 'Zona de descarga',
  zona_autorizada: 'Zona autorizada',
  zona_restringida: 'Zona restringida',
  comuna: 'Comuna',
  ruta: 'Ruta',
  personalizada: 'Personalizada',
};

const TRIGGERS: { id: GeofenceTrigger; label: string; hint: string }[] = [
  { id: 'entrada', label: 'Entrada', hint: 'El vehiculo cruza hacia el interior.' },
  { id: 'salida', label: 'Salida', hint: 'El vehiculo abandona el perimetro.' },
  {
    id: 'permanencia',
    label: 'Permanencia',
    hint: 'Se queda dentro el tiempo minimo configurado.',
  },
  { id: 'detencion', label: 'Detencion', hint: 'Se detiene dentro del perimetro.' },
  {
    id: 'exceso_tiempo',
    label: 'Exceso de tiempo',
    hint: 'Supera el tiempo maximo permitido dentro.',
  },
  {
    id: 'entrada_fuera_horario',
    label: 'Entrada fuera de horario',
    hint: 'Ingresa fuera de la ventana autorizada.',
  },
  {
    id: 'salida_fuera_horario',
    label: 'Salida fuera de horario',
    hint: 'Sale fuera de la ventana autorizada.',
  },
  {
    id: 'vehiculo_no_autorizado',
    label: 'Vehiculo no autorizado',
    hint: 'Entra un camion que no figura en la lista permitida.',
  },
  {
    id: 'entrega_detectada',
    label: 'Entrega detectada',
    hint: 'La permanencia confirma la entrega del pedido.',
  },
  {
    id: 'paso_por_cliente',
    label: 'Paso por cliente',
    hint: 'Pasa por el domicilio sin detenerse lo suficiente.',
  },
];

export interface GeofenceFormValues {
  name: string;
  description: string;
  kind: GeofenceKind;
  active: boolean;
  rules: GeofenceRules;
}

export function buildInitialValues(geofence: Geofence | null): GeofenceFormValues {
  return {
    name: geofence?.name ?? '',
    description: geofence?.description ?? '',
    kind: geofence?.kind ?? 'personalizada',
    active: geofence?.active ?? true,
    rules: geofence?.rules ?? { ...DEFAULT_GEOFENCE_RULES },
  };
}

export interface GeofenceFormProps {
  values: GeofenceFormValues;
  onChange: (values: GeofenceFormValues) => void;
  geometry: GeofenceGeometry | null;
  onRadiusChange: (radiusMeters: number) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  editing: boolean;
}

export function GeofenceForm({
  values,
  onChange,
  geometry,
  onRadiusChange,
  onSubmit,
  onCancel,
  saving,
  error,
  editing,
}: GeofenceFormProps) {
  const [showAllTriggers, setShowAllTriggers] = useState(false);

  const update = (patch: Partial<GeofenceFormValues>): void => onChange({ ...values, ...patch });
  const updateRules = (patch: Partial<GeofenceRules>): void =>
    onChange({ ...values, rules: { ...values.rules, ...patch } });

  const toggleTrigger = (trigger: GeofenceTrigger): void => {
    const next = values.rules.triggers.includes(trigger)
      ? values.rules.triggers.filter((t) => t !== trigger)
      : [...values.rules.triggers, trigger];
    updateRules({ triggers: next });
  };

  const needsMinDwell =
    values.rules.triggers.includes('permanencia') ||
    values.rules.triggers.includes('entrega_detectada');
  const needsMaxDwell = values.rules.triggers.includes('exceso_tiempo');
  const needsSchedule =
    values.rules.triggers.includes('entrada_fuera_horario') ||
    values.rules.triggers.includes('salida_fuera_horario');

  const visibleTriggers = showAllTriggers ? TRIGGERS : TRIGGERS.slice(0, 5);

  return (
    <div className="space-y-5 p-4">
      <div>
        <label className="field-label" htmlFor="gf-nombre">
          Nombre
        </label>
        <Input
          id="gf-nombre"
          value={values.name}
          onChange={(event) => update({ name: event.target.value })}
          placeholder="Ej: Estacion de Servicio Andina - descarga"
        />
      </div>

      <div>
        <label className="field-label" htmlFor="gf-descripcion">
          Descripcion
        </label>
        <Input
          id="gf-descripcion"
          value={values.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="Instruccion operacional u observacion"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label" htmlFor="gf-tipo">
            Tipo
          </label>
          <Select
            id="gf-tipo"
            value={values.kind}
            onChange={(event) => update({ kind: event.target.value as GeofenceKind })}
            options={(Object.keys(GEOFENCE_KIND_LABEL) as GeofenceKind[]).map((kind) => ({
              value: kind,
              label: GEOFENCE_KIND_LABEL[kind],
            }))}
          />
        </div>

        <div>
          <label className="field-label" htmlFor="gf-severidad">
            Severidad de sus alertas
          </label>
          <Select
            id="gf-severidad"
            value={values.rules.severity}
            onChange={(event) =>
              updateRules({ severity: event.target.value as GeofenceRules['severity'] })
            }
            options={[
              { value: 'info', label: 'Informativa' },
              { value: 'warning', label: 'Advertencia' },
              { value: 'critical', label: 'Critica' },
            ]}
          />
        </div>
      </div>

      {/* --- Radio, solo para geocercas circulares --- */}
      {geometry?.shape === 'circle' ? (
        <div>
          <label className="field-label">Radio</label>
          <div className="flex flex-wrap gap-1.5">
            {GEOFENCE_RADIUS_PRESETS.map((radius) => (
              <button
                key={radius}
                type="button"
                onClick={() => onRadiusChange(radius)}
                className={cn(
                  'tap rounded-md border px-3 text-xs transition-colors sm:h-8 sm:min-h-0',
                  geometry.radiusMeters === radius
                    ? 'border-brand-500 bg-brand-500/10 text-brand-700'
                    : 'border-line text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {radius} m
              </button>
            ))}
          </div>
          <NumberField
            className="mt-2"
            label="Radio personalizado"
            suffix="m"
            min={20}
            max={5000}
            value={geometry.radiusMeters}
            onChange={(event) => {
              const parsed = Number(event.target.value);
              if (Number.isFinite(parsed)) onRadiusChange(parsed);
            }}
          />
        </div>
      ) : null}

      {/* --- Reglas de deteccion --- */}
      <div>
        <p className="field-label">Que desea detectar</p>
        <p className="mb-2 text-2xs leading-relaxed text-ink-faint">
          Sin al menos un evento seleccionado, la geocerca se dibuja en el mapa pero no
          genera ninguna alerta.
        </p>

        <ul className="space-y-1">
          {visibleTriggers.map((trigger) => {
            const checked = values.rules.triggers.includes(trigger.id);
            return (
              <li key={trigger.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleTrigger(trigger.id)}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                    checked
                      ? 'border-brand-500/40 bg-brand-500/8'
                      : 'border-line hover:border-line-strong',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold',
                      checked
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-line-strong text-transparent',
                    )}
                  >
                    ✓
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-ink">{trigger.label}</span>
                    <span className="block text-2xs leading-relaxed text-ink-faint">
                      {trigger.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => setShowAllTriggers((value) => !value)}
          className="mt-2 text-2xs text-brand-700 hover:underline"
        >
          {showAllTriggers ? 'Mostrar menos' : `Ver ${TRIGGERS.length - 5} eventos mas`}
        </button>
      </div>

      {/* --- Parametros que dependen de los eventos elegidos --- */}
      {needsMinDwell || needsMaxDwell ? (
        <div className="grid grid-cols-2 gap-3">
          {needsMinDwell ? (
            <NumberField
              label="Permanencia minima"
              suffix="s"
              min={0}
              max={7200}
              value={values.rules.minDwellSeconds ?? ''}
              onChange={(event) =>
                updateRules({
                  minDwellSeconds: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              hint="Evita confirmar por un simple paso frente al domicilio."
            />
          ) : null}

          {needsMaxDwell ? (
            <NumberField
              label="Tiempo maximo dentro"
              suffix="s"
              min={60}
              max={86400}
              value={values.rules.maxDwellSeconds ?? ''}
              onChange={(event) =>
                updateRules({
                  maxDwellSeconds: event.target.value === '' ? null : Number(event.target.value),
                })
              }
              hint="Superarlo indica demora en playa de carga."
            />
          ) : null}
        </div>
      ) : null}

      {needsSchedule ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="gf-desde">
              Autorizado desde
            </label>
            <Input
              id="gf-desde"
              type="time"
              value={values.rules.allowedFrom ?? ''}
              onChange={(event) => updateRules({ allowedFrom: event.target.value || null })}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="gf-hasta">
              Autorizado hasta
            </label>
            <Input
              id="gf-hasta"
              type="time"
              value={values.rules.allowedTo ?? ''}
              onChange={(event) => updateRules({ allowedTo: event.target.value || null })}
            />
          </div>
        </div>
      ) : null}

      <Toggle
        label="Geocerca activa"
        hint="Una geocerca inactiva conserva su definicion pero deja de evaluarse."
        checked={values.active}
        onChange={(active) => update({ active })}
      />

      {error ? (
        <p className="rounded-md border border-status-dormant/30 bg-status-dormant/5 px-3 py-2 text-xs text-ink">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          onClick={onSubmit}
          loading={saving}
          disabled={!geometry || values.name.trim().length < 2}
        >
          {editing ? 'Guardar cambios' : 'Crear geocerca'}
        </Button>
      </div>

      {!geometry ? (
        <p className="text-2xs text-ink-faint">
          Dibuja la geocerca en el mapa para poder guardarla.
        </p>
      ) : null}
    </div>
  );
}
