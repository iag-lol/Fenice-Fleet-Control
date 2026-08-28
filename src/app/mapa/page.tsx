import { OperationalMap } from '@/components/map/operational-map';
import { AppShell } from '@/components/shell/app-shell';

export const metadata = {
  title: 'Mapa operacional',
  description: 'Centro de control GPS: flota, clientes, rutas, geocercas y alertas en un solo mapa.',
};

export default function MapaPage() {
  return (
    <AppShell fullBleed>
      <OperationalMap />
    </AppShell>
  );
}
