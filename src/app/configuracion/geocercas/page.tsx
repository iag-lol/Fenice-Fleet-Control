import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { GeofenceEditorView } from '@/features/base/geofence-editor/geofence-editor-view';

export const metadata = { title: 'Geocercas' };

export default function GeocercasPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el editor de geocercas">
        <GeofenceEditorView />
      </ErrorBoundary>
    </AppShell>
  );
}
