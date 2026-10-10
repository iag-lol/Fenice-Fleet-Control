'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { VEHICLE_GROUPS, VEHICLE_GROUP_LABEL, vehicleGroup } from '@/lib/vehicle-groups';
import type { Vehicle, VehicleGroup } from '@/types/core';

export function VehicleGroupEditor({ vehicle }: { vehicle: Vehicle }) {
  const current = vehicleGroup(vehicle);
  const [draft, setDraft] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { refresh } = useLiveFleet();
  const value = draft ?? current;
  const save = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/fleet/${encodeURIComponent(vehicle.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: value === 'sin_grupo' ? null : value as VehicleGroup }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? 'No fue posible guardar el grupo.');
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] }),
        queryClient.invalidateQueries({ queryKey: ['fleet'] }),
        queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] }),
      ]);
      refresh(); setDraft(null);
    },
  });
  return <div className="rounded-lg border border-line bg-surface-800 p-3">
    <label className="field-label" htmlFor={`vehicle-group-${vehicle.id}`}>Grupo del vehículo</label>
    <div className="flex items-center gap-2">
      <Select id={`vehicle-group-${vehicle.id}`} value={value} disabled={save.isPending}
        onChange={event => { setDraft(event.target.value); save.reset(); }}
        options={[{ value: 'sin_grupo', label: 'Sin grupo' }, ...VEHICLE_GROUPS.map(group => ({ value: group, label: VEHICLE_GROUP_LABEL[group] }))]} className="min-w-0 flex-1" />
      <Button size="sm" variant="primary" loading={save.isPending} disabled={value === current} onClick={() => save.mutate()}>Guardar</Button>
    </div>
    {save.isError ? <p role="alert" className="mt-2 text-xs text-status-dormant">{save.error.message}</p> : null}
    {save.isSuccess ? <p role="status" className="mt-2 text-xs text-status-active">Grupo guardado.</p> : null}
  </div>;
}
