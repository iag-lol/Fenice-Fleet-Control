// Ejecutar como proceso de servicio, incluso cuando nadie tiene el mapa abierto.
import { loadEnvConfig } from '@next/env';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const { getGpsProvider } = await import('../src/services/registry');
  const { getOperationalSettings } = await import('../src/services/settings/settings-store');
  let stopping = false;
  let wake: (() => void) | undefined;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => { stopping = true; wake?.(); });
  }
  console.log('Grabador GPS iniciado. Las muestras se guardan en GPS_HISTORY_DIR.');
  while (!stopping) {
    try { await getGpsProvider().getAllCurrentPositions(); }
    catch (error) {
      console.error('GPS pendiente de reconexion:', error instanceof Error ? error.message : error);
    }
    if (!stopping) await new Promise<void>((done) => {
      const timer = setTimeout(done, getOperationalSettings().gps.refreshIntervalMs);
      wake = () => { clearTimeout(timer); done(); };
    });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
