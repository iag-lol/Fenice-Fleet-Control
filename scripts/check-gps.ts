// Diagnostico de solo lectura. Nunca imprime claves ni crea vehiculos.
import { loadEnvConfig } from '@next/env';
import { access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const args = process.argv.slice(2);
  const value = (key: string) => { const index = args.indexOf(key); return index < 0 ? undefined : args[index + 1]; };
  if (args.includes('--help')) {
    console.log('npm run gps:check -- [--plate RBDC59] [--imei 15-digitos] [--history]'); return;
  }
  const plate = value('--plate') ?? 'RBDC59';
  const imei = value('--imei');
  if (imei && !/^\d{15}$/.test(imei)) throw new Error('El IMEI debe tener 15 digitos.');
  const { getServerEnv } = await import('../src/config/env');
  const env = getServerEnv();
  const configured = !!(env.TRIDTRACKING_USERNAME && env.TRIDTRACKING_PASSWORD);
  const historyDir = resolve(process.env.GPS_HISTORY_DIR?.trim() || '.fenice/gps-history');
  let archiveWritable = false;
  try { await mkdir(historyDir, { recursive: true, mode: 0o700 }); await access(historyDir, constants.W_OK); archiveWritable = true; } catch { /* Se informa sin ocultar el bloqueo. */ }
  const summary = { provider: env.GPS_PROVIDER, credentialsPresent: configured,
    demoEnabled: /^(true|1|yes|si)$/i.test(process.env.DEMO_MODE || process.env.NEXT_PUBLIC_DEMO_MODE || ''),
    authEnabled: env.AUTH_ENABLED, fleetPersistence: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY), archiveWritable };
  console.log(JSON.stringify({ configuration: summary }, null, 2));
  if (!configured || env.GPS_PROVIDER !== '3dtracking') {
    console.log('PENDIENTE: GPS_PROVIDER=3dtracking y credenciales TRIDTRACKING_USERNAME / TRIDTRACKING_PASSWORD.');
    process.exitCode = 1; return;
  }
  const { getGpsProvider } = await import('../src/services/registry');
  const { getOperationalSettings } = await import('../src/services/settings/settings-store');
  const { checkTridReadiness } = await import('../src/services/gps/tridtracking/tridtracking-readiness');
  const report = await checkTridReadiness(getGpsProvider(), { plate, imei, history: args.includes('--history'),
    maxAgeSeconds: getOperationalSettings().gps.staleSeconds });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok || !report.ignitionKnown || !archiveWritable || summary.demoEnabled) process.exitCode = 1;
}
void main().catch(() => { console.error('No fue posible completar el diagnostico GPS. Revisa configuracion y disponibilidad del proveedor.'); process.exitCode = 1; });
