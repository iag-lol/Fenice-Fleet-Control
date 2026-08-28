import { MapPinOff } from 'lucide-react';

import { LinkButton } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="flex min-h-app flex-col items-center justify-center gap-4 bg-surface-950 px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-800 text-ink-faint">
        <MapPinOff className="h-6 w-6" />
      </span>

      <div className="max-w-md space-y-1.5">
        <h1 className="text-base font-semibold text-ink">No encontramos esta pagina</h1>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          El recurso solicitado no existe o fue movido. Vuelve al panel operacional para continuar.
        </p>
      </div>

      <LinkButton href="/" variant="primary">
        Ir al panel operacional
      </LinkButton>
    </div>
  );
}
