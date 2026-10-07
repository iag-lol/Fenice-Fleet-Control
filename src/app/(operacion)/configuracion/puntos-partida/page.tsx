import { ErrorBoundary } from '@/components/ui/error-boundary';
import { DepotPointView } from '@/features/base/depot-points/depot-point-view';

export const metadata = { title: 'Puntos de partida' };

export default function PuntosPartidaPage() {
  return (
    <ErrorBoundary section="los puntos de partida">
      <DepotPointView />
    </ErrorBoundary>
  );
}
