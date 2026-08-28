import { AppShell } from '@/components/shell/app-shell';
import { SettingsView } from '@/components/settings/settings-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Configuracion operacional' };

export default function ConfiguracionPage() {
  return (
    <AppShell>
      <ErrorBoundary section="la configuracion operacional">
        <SettingsView />
      </ErrorBoundary>
    </AppShell>
  );
}
