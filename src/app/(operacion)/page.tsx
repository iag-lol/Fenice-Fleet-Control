import { DashboardView } from '@/components/dashboard/dashboard-view';
import { ErrorBoundary } from '@/components/ui/error-boundary';

export const metadata = { title: 'Panel operacional' };

export default function DashboardPage() {
  return (
    <ErrorBoundary section="el panel operacional">
      <DashboardView />
    </ErrorBoundary>
  );
}
