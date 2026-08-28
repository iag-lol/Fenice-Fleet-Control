import { EvidenceGalleryView } from '@/features/medium/evidence/evidence-gallery-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Evidencia de entrega' };

export default function EvidenciasPage() {
  return (
    <AppShell>
      <ErrorBoundary section="la evidencia de entrega">
        <EvidenceGalleryView />
      </ErrorBoundary>
    </AppShell>
  );
}
