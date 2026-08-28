'use client';

import { useQuery } from '@tanstack/react-query';
import { Camera, FileSearch } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import type { DeliveryProof } from '@/types/core';
import { ProofCard } from './proof-card';

/**
 * Galeria de la evidencia recogida en terreno.
 *
 * Sirve para dos cosas concretas: responder un reclamo ("¿quien recibio?") y
 * revisar entregas dudosas. Por eso el primer filtro es el resultado y el
 * segundo, la firma lejos del domicilio.
 */

interface ProofItem extends DeliveryProof {
  photoCount: number;
  workOrderNumber: string | null;
  orderNumber: string | null;
  clientName: string | null;
  addressLine: string | null;
  communeName: string | null;
}

type Filtro = 'todas' | 'entregada' | 'incidencia' | 'conFoto';

const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'entregada', label: 'Entregadas' },
  { id: 'incidencia', label: 'Incidencias' },
  { id: 'conFoto', label: 'Con fotografia' },
];

export function EvidenceGalleryView() {
  const [filtro, setFiltro] = useState<Filtro>('todas');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['evidencias', filtro],
    refetchInterval: 60_000,
    queryFn: async (): Promise<{ items: ProofItem[]; imagesIncluded: boolean }> => {
      const params = new URLSearchParams();
      if (filtro === 'entregada' || filtro === 'incidencia') params.set('resultado', filtro);
      if (filtro === 'conFoto') params.set('conFoto', 'true');

      const response = await fetch(`/api/evidencias?${params.toString()}`);
      if (!response.ok) throw new Error('No fue posible obtener la evidencia.');
      return (await response.json()) as { items: ProofItem[]; imagesIncluded: boolean };
    },
  });

  return (
    <>
      <PageHeader
        title="Evidencia de entrega"
        description="Lo que el conductor declaro en cada parada, con su origen y su hora real"
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFiltro(item.id)}
            className={`h-11 rounded-md border px-3.5 text-sm font-medium transition-colors sm:h-9 sm:px-3 sm:text-[13px] ${
              filtro === item.id
                ? 'border-brand-500 bg-brand-500/10 text-ink'
                : 'border-line-strong bg-surface-900 text-ink-muted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {isError ? (
        <QueryError
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      ) : isLoading ? (
        <SkeletonRows rows={4} />
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={<Camera className="h-6 w-6" />}
          title="Todavia no hay evidencia registrada"
          description="Aparece aqui en cuanto un conductor cierra una parada desde su portal, incluso si la declaro sin conexion."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {data?.items.map((item) => (
            <Card key={item.id}>
              <CardBody className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {item.clientName ?? 'Cliente sin identificar'}
                    </p>
                    <p className="truncate text-2xs text-ink-faint">
                      {item.addressLine}
                      {item.communeName ? `, ${item.communeName}` : ''}
                    </p>
                  </div>
                  {item.workOrderNumber ? (
                    <Link
                      href={`/ordenes/${item.workOrderId}`}
                      className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md border border-line-strong px-3 text-xs font-medium text-ink-muted hover:text-ink sm:h-8 sm:px-2 sm:text-2xs"
                    >
                      <FileSearch className="h-3.5 w-3.5" />
                      {item.workOrderNumber}
                    </Link>
                  ) : null}
                </div>

                <ProofCard proof={item} />

                {!data.imagesIncluded && item.photoCount > 0 ? (
                  <p className="text-2xs text-ink-faint">
                    {item.photoCount} fotografia{item.photoCount === 1 ? '' : 's'} disponible
                    {item.photoCount === 1 ? '' : 's'} en el detalle de la orden.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
