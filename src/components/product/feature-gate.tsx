'use client';

import { Lock } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { resolveFeature } from '@/product/feature-access';
import type { FeatureId } from '@/product/features';
import { IMPLEMENTATION_LABEL, PLAN_LABEL } from '@/product/plans';

/**
 * Compuerta de funcionalidad.
 *
 * Envuelve una funcion y decide que ocurre segun el plan y el estado de
 * implementacion: mostrarla, ocultarla o presentarla como mejora. Concentrar
 * esta decision evita que la logica de planes se disperse por la interfaz.
 */
export interface FeatureGateProps {
  featureId: FeatureId;
  children: ReactNode;
  /** Sustituto cuando la funcion no es usable. Si se omite, no se muestra nada. */
  fallback?: ReactNode;
  /**
   * Mostrar el contenido aunque la funcion aun no opere.
   * Util para pantallas que se ven pero avisan que faltan credenciales.
   */
  renderWhenNotOperational?: boolean;
}

export function FeatureGate({
  featureId,
  children,
  fallback,
  renderWhenNotOperational,
}: FeatureGateProps) {
  const access = resolveFeature(featureId);

  if (access.usable) return <>{children}</>;
  if (renderWhenNotOperational && access.includedInPlan) return <>{children}</>;
  if (!access.visible) return null;

  return <>{fallback ?? null}</>;
}

/**
 * Boton de una funcion de plan superior.
 *
 * Al pulsarlo abre una ficha que explica que aporta. Nunca muestra precios:
 * la conversacion comercial no ocurre dentro de la herramienta de operacion.
 */
export function UpgradeAction({
  featureId,
  label,
  icon,
  className,
}: {
  featureId: FeatureId;
  label?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const access = resolveFeature(featureId);
  const [open, setOpen] = useState(false);

  if (!access.visible || access.usable) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'tap inline-flex items-center gap-2 rounded-md border border-line bg-surface-800 px-3 text-[13px] text-ink-muted transition-colors hover:border-line-strong hover:text-ink sm:h-9 sm:min-h-0',
          className,
        )}
      >
        {icon ?? <Lock className="h-3.5 w-3.5 text-ink-faint" />}
        <span className="truncate">{label ?? access.feature.name}</span>
      </button>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={access.feature.name}
        description={
          access.showsAsUpgrade
            ? PLAN_LABEL[access.requiredPlan]
            : IMPLEMENTATION_LABEL[access.state]
        }
      >
        <div className="space-y-5 p-4">
          <p className="text-[13px] leading-relaxed text-ink-muted">
            {access.feature.description}
          </p>

          {access.reason ? (
            <div className="rounded-md border border-brand-500/25 bg-brand-500/5 px-3 py-2.5">
              <p className="text-xs leading-relaxed text-ink">{access.reason}</p>
            </div>
          ) : null}

          {access.feature.requiredEnv && access.feature.requiredEnv.length > 0 ? (
            <div>
              <p className="field-label">Configuracion necesaria</p>
              <ul className="space-y-1">
                {access.feature.requiredEnv.map((variable) => (
                  <li
                    key={variable}
                    className="numeric rounded border border-line bg-surface-800 px-2 py-1 text-2xs text-ink-muted"
                  >
                    {variable}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <Button block variant="secondary" onClick={() => setOpen(false)}>
            Entendido
          </Button>
        </div>
      </Sheet>
    </>
  );
}
