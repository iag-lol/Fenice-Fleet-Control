import { apiError, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { canUseFeature } from '@/product/feature-access';
import { listProofs } from '@/services/deliveries/proof-store';
import { getOperationsProvider } from '@/services/registry';
import type { DeliveryProof, RouteId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Evidencia recogida en terreno, para la operacion.
 *
 * Las fotografias pesan: se devuelven completas solo cuando se consulta una
 * ruta concreta. En el listado general viajan las miniaturas contadas pero no
 * las imagenes, para que la galeria abra rapido y descargue bajo demanda.
 */
export async function GET(request: Request): Promise<Response> {
  if (!canUseFeature('proof-of-delivery')) {
    return apiError('La evidencia de entrega no esta incluida en este plan.', 404);
  }

  const denied = await guardApi('ordenes.ver');
  if (denied) return denied;

  const url = new URL(request.url);
  const routeId = url.searchParams.get('ruta')?.trim() ?? '';
  const outcome = url.searchParams.get('resultado')?.trim() ?? '';
  const withPhotos = url.searchParams.get('conFoto') === 'true';
  const includeImages = routeId.length > 0;

  try {
    const proofs = await listProofs({
      ...(routeId ? { routeId: routeId as RouteId } : {}),
      ...(outcome === 'entregada' || outcome === 'incidencia' ? { outcome } : {}),
      ...(withPhotos ? { withPhotosOnly: true } : {}),
      limit: 200,
    });

    // Se enriquece con lo minimo para que la galeria sea legible sin obligar
    // a la pantalla a cruzar tres endpoints.
    const operations = getOperationsProvider();
    const workOrders = await Promise.all(
      proofs.map((proof) => operations.getWorkOrderById(proof.workOrderId)),
    );

    const items = proofs.map((proof, index) => {
      const workOrder = workOrders[index] ?? null;
      const photos: DeliveryProof['photos'] = includeImages
        ? proof.photos
        : proof.photos.map((photo) => ({ ...photo, dataUrl: '' }));

      return {
        ...proof,
        photos,
        photoCount: proof.photos.length,
        workOrderNumber: workOrder?.number ?? null,
        orderNumber: workOrder?.orderNumber ?? null,
        clientName: workOrder?.clientName ?? null,
        addressLine: workOrder?.addressLine ?? null,
        communeName: workOrder?.communeName ?? null,
      };
    });

    const response = NextResponse.json({
      items,
      total: items.length,
      /** `false` avisa a la pantalla de que debe pedir la ruta para ver fotos. */
      imagesIncluded: includeImages,
    });
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
    return response;
  } catch (error) {
    return apiError(
      'No fue posible obtener la evidencia de entrega.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
