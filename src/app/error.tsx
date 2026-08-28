'use client';

import { AlertTriangle, RotateCw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Limite de error de la aplicacion. Ultimo recurso: los limites por seccion
 * capturan antes la mayoria de los fallos para no perder toda la pantalla.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app]', error);
  }, [error]);

  return (
    <div className="flex min-h-app flex-col items-center justify-center gap-4 bg-surface-950 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-status-dormant/15 text-status-dormant">
        <AlertTriangle className="h-6 w-6" />
      </span>

      <div className="max-w-md space-y-1.5">
        <h1 className="text-base font-semibold text-ink">Se produjo un error inesperado</h1>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          La plataforma no pudo completar la operacion solicitada. Puedes reintentar sin perder tu
          sesion de trabajo.
        </p>
        {error.digest ? (
          <p className="numeric text-2xs text-ink-faint">Referencia tecnica: {error.digest}</p>
        ) : null}
      </div>

      <Button variant="primary" icon={<RotateCw className="h-4 w-4" />} onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
