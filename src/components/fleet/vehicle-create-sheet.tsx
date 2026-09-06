'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input, NumberField, Select, Toggle } from '@/components/ui/input';
import { Sheet } from '@/components/ui/sheet';
import type { VehicleType } from '@/types/core';

const VEHICLE_TYPE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: 'cisterna_semirremolque', label: 'Cisterna semirremolque' },
  { value: 'cisterna_rigido', label: 'Cisterna rigido' },
  { value: 'camioneta_estanque', label: 'Camioneta estanque' },
];

interface FormState {
  plate: string;
  fleetCode: string;
  brand: string;
  model: string;
  year: string;
  type: VehicleType;
  capacityM3: string;
  compartments: string;
  depotName: string;
  active: boolean;
}

const EMPTY_FORM: FormState = {
  plate: '',
  fleetCode: '',
  brand: '',
  model: '',
  year: '',
  type: 'cisterna_semirremolque',
  capacityM3: '',
  compartments: '1',
  depotName: '',
  active: true,
};

export interface VehicleCreateSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Alta de un vehiculo de la flota. Artefacto propio de la plataforma, no del ERP. */
export function VehicleCreateSheet({ open, onClose }: VehicleCreateSheetProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>): void => setForm((current) => ({ ...current, ...patch }));

  const create = useMutation({
    mutationFn: async (): Promise<void> => {
      const response = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: form.plate,
          fleetCode: form.fleetCode,
          brand: form.brand,
          model: form.model,
          year: form.year ? Number(form.year) : null,
          type: form.type,
          capacityM3: Number(form.capacityM3),
          compartments: Number(form.compartments),
          depotName: form.depotName,
          active: form.active,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; issues?: string[] }
          | null;
        throw new Error(body?.issues?.join(' · ') ?? body?.error ?? 'No fue posible crear el vehiculo.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
      setForm(EMPTY_FORM);
      setError(null);
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No fue posible crear el vehiculo.'),
  });

  const capacityLiters = Number(form.capacityM3) > 0 ? Math.round(Number(form.capacityM3) * 1000) : null;
  const valid = form.plate.trim().length >= 5 && form.fleetCode.trim().length > 0 && Number(form.capacityM3) > 0;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nuevo vehiculo"
      description="Se agrega a la flota propia de la plataforma."
    >
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="veh-patente">
              Patente
            </label>
            <Input
              id="veh-patente"
              value={form.plate}
              onChange={(event) => update({ plate: event.target.value })}
              placeholder="RXKL-30"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="veh-codigo">
              Codigo de flota
            </label>
            <Input
              id="veh-codigo"
              value={form.fleetCode}
              onChange={(event) => update({ fleetCode: event.target.value })}
              placeholder="C-104"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="veh-marca">
              Marca
            </label>
            <Input
              id="veh-marca"
              value={form.brand}
              onChange={(event) => update({ brand: event.target.value })}
              placeholder="Mercedes-Benz"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="veh-modelo">
              Modelo
            </label>
            <Input
              id="veh-modelo"
              value={form.model}
              onChange={(event) => update({ model: event.target.value })}
              placeholder="Actros 2646"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Anio"
            value={form.year}
            onChange={(event) => update({ year: event.target.value })}
            placeholder="2022"
          />
          <div>
            <label className="field-label" htmlFor="veh-tipo">
              Tipo
            </label>
            <Select
              id="veh-tipo"
              value={form.type}
              onChange={(event) => update({ type: event.target.value as VehicleType })}
              options={VEHICLE_TYPE_OPTIONS}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Capacidad"
            suffix="m³"
            min={1}
            max={60}
            value={form.capacityM3}
            onChange={(event) => update({ capacityM3: event.target.value })}
            hint={capacityLiters ? `= ${capacityLiters.toLocaleString('es-CL')} litros` : 'Capacidad del estanque'}
          />
          <NumberField
            label="Compartimentos"
            min={1}
            max={10}
            value={form.compartments}
            onChange={(event) => update({ compartments: event.target.value })}
            hint="Cuantos productos distintos puede llevar a la vez"
          />
        </div>

        <div>
          <label className="field-label" htmlFor="veh-base">
            Base de despacho
          </label>
          <Input
            id="veh-base"
            value={form.depotName}
            onChange={(event) => update({ depotName: event.target.value })}
            placeholder="Planta Maipu"
          />
        </div>

        <Toggle
          label="Vehiculo activo"
          hint="Un vehiculo inactivo no aparece disponible para asignar rutas."
          checked={form.active}
          onChange={(active) => update({ active })}
        />

        {error ? (
          <p className="rounded-md border border-status-dormant/30 bg-status-dormant/5 px-3 py-2 text-xs text-ink">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!valid}
          >
            Crear vehiculo
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
