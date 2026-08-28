
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { ControlTowerView } from '@/features/medium/control-tower/control-tower-view';

export const metadata = {
  title: 'Torre de control',
  description: 'Centro de operacion: mapa, flota, despachos y alertas en una sola pantalla.',
};

export default function ControlPage() {
  return (
    <AppShell fullBleed>
      <ErrorBoundary section="la torre de control">
        <ControlTowerView />
      </ErrorBoundary>
    </AppShell>
  );
}
