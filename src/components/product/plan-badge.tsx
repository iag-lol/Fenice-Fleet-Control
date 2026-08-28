'use client';

import { Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { getProductConfig, PLAN_SHORT_LABEL } from '@/product/plans';
import { resolveFeature } from '@/product/feature-access';
import type { FeatureId } from '@/product/features';

/**
 * Distintivo de plan.
 *
 * Discreto por diseno: senala a que plan pertenece una funcion sin convertir
 * la interfaz operacional en un folleto comercial. Desaparece por completo
 * cuando `NEXT_PUBLIC_SHOW_PLAN_BADGES=false`.
 */
export function PlanBadge({ featureId, className }: { featureId: FeatureId; className?: string }) {
  const config = getProductConfig();
  const access = resolveFeature(featureId);

  if (!config.showPlanBadges) return null;
  // Lo que ya viene incluido no necesita anunciarse.
  if (access.includedInPlan && access.usable) return null;
  if (!access.visible) return null;

  if (access.showsAsUpgrade) {
    return (
      <Badge
        tone="neutral"
        size="sm"
        className={cn('gap-1', className)}
        icon={<Lock className="h-2.5 w-2.5" />}
      >
        Plan {PLAN_SHORT_LABEL[access.requiredPlan]}
      </Badge>
    );
  }

  // Incluida en el plan pero sin poder operar: el motivo importa mas que el plan.
  return (
    <Badge tone="warning" size="sm" className={className}>
      {access.state === 'requires-provider' ? 'Requiere proveedor' : 'Pendiente de datos'}
    </Badge>
  );
}

/** Etiqueta del plan contratado, para cabeceras y pantallas de sistema. */
export function CurrentPlanBadge({ className }: { className?: string }) {
  const { plan, showPlanBadges } = getProductConfig();
  if (!showPlanBadges) return null;

  return (
    <Badge tone="brand" size="sm" className={className}>
      Plan {PLAN_SHORT_LABEL[plan]}
    </Badge>
  );
}
