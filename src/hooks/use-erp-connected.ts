'use client';

import { useQuery } from '@tanstack/react-query';

import type { SystemModeInfo } from '@/services/registry';

interface SystemModeResponse extends SystemModeInfo {
  settings: unknown;
}

/**
 * Clientes, pedidos y ordenes de trabajo viven en el ERP de Fenice
 * (`EXTERNAL_DB_*`), nunca en el dataset de demostracion ni en Supabase. Sin
 * esa conexion (`OPERATIONS_PROVIDER=external`) esas listas vienen vacias por
 * diseno: la interfaz necesita distinguir "vacio porque no hay fuente" de
 * "vacio porque los filtros no calzan con nada".
 */
export function useErpConnected(): boolean {
  const { data } = useQuery({
    queryKey: ['system', 'mode'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SystemModeResponse> => {
      const response = await fetch('/api/system/mode');
      if (!response.ok) throw new Error('Estado del sistema no disponible');
      return (await response.json()) as SystemModeResponse;
    },
  });

  return data?.operations.provider === 'external';
}
