import { DashboardView } from '@/components/dashboard/dashboard-view';
import { AppShell } from '@/components/shell/app-shell';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Panel operacional' };

export default function DashboardPage() {
  return (
    <AppShell>
      <ErrorBoundary section="el panel operacional">
        <DashboardView />
      </ErrorBoundary>
    </AppShell>
  );
}
