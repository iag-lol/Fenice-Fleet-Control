'use client';

import { queryOptions, useQuery } from '@tanstack/react-query';
import type { CommuneWithSummary } from '@/components/map/commune-panel';
import type { OperationalSettings } from '@/config/operational';
import type { SystemModeInfo } from '@/services/registry';
import type { Alert } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

/** Lo que realmente responde `/api/system/mode`: incluye los umbrales configurables. */
export interface SystemModeResponse extends SystemModeInfo {
  settings: OperationalSettings;
}

async function read<T>(url: string, label: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`No fue posible cargar ${label}.`);
  return response.json() as Promise<T>;
}

export const mapQuery = queryOptions({
  queryKey: ['map', 'snapshot'],
  queryFn: ({ signal }) => read<MapSnapshot>('/api/map', 'la operación', signal),
  staleTime: 15_000,
  refetchInterval: 30_000,
});
export const alertsQuery = queryOptions({
  queryKey: ['alerts'],
  queryFn: ({ signal }) => read<{ alerts: Alert[] }>('/api/alertas', 'las alertas', signal),
  staleTime: 15_000,
  refetchInterval: 30_000,
});
export const communesQuery = queryOptions({
  queryKey: ['communes'],
  queryFn: ({ signal }) => read<{ communes: CommuneWithSummary[] }>('/api/comunas', 'las comunas', signal),
  staleTime: 60_000,
  refetchInterval: 60_000,
});
export const systemModeQuery = queryOptions({
  queryKey: ['system', 'mode'],
  queryFn: ({ signal }) => read<SystemModeResponse>('/api/system/mode', 'el estado del sistema', signal),
  staleTime: 5 * 60_000,
});

export function useControlData() {
  const map = useQuery(mapQuery);
  const alerts = useQuery(alertsQuery);
  const communes = useQuery(communesQuery);
  return { map, alerts, communes };
}
