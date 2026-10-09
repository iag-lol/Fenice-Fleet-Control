export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NEXT_PHASE === 'phase-production-build' || process.argv.includes('build')) return;
    const { startAlertWorker } = await import('@/services/notifications/background-worker');
    startAlertWorker();
  }
}
