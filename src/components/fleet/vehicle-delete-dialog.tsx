'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { Vehicle } from '@/types/core';

export function VehicleDeleteDialog({
  vehicle,
  open,
  onClose,
  onDeleted,
}: {
  vehicle: Pick<Vehicle, 'id' | 'plate' | 'fleetCode'>;
  open: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: async (): Promise<void> => {
      const response = await fetch(`/api/fleet/${vehicle.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No fue posible eliminar el vehículo.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] });
      void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
      void queryClient.invalidateQueries({ queryKey: ['geofences'] });
      queryClient.removeQueries({ queryKey: ['vehicle', vehicle.id] });
      onClose();
      onDeleted?.();
    },
  });

  const close = (): void => {
    if (remove.isPending) return;
    remove.reset();
    onClose();
  };

  return (
    <ConfirmDialog
      open={open}
      title="Eliminar vehículo"
      subject={`${vehicle.plate} · ${vehicle.fleetCode}`}
      description="Se eliminará la ficha del vehículo de la flota. Las rutas y registros históricos se conservan, pero quedarán sin este vehículo asignado."
      confirmLabel="Eliminar vehículo"
      loading={remove.isPending}
      error={remove.error instanceof Error ? remove.error.message : null}
      onClose={close}
      onConfirm={() => remove.mutate()}
    />
  );
}
