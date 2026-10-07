import { permanentRedirect } from 'next/navigation';

/**
 * El mapa operacional y la torre de control eran la misma pantalla: el mismo
 * mapa, con o sin panel lateral. Se unificaron en `/control`, que en Plan
 * Basico muestra el mapa completo y en Plan Medio le suma el panel.
 *
 * Esta redireccion permanente se conserva para no romper enlaces guardados
 * por los operadores ni los que ya circulan por correo.
 */
export default function MapaPage(): never {
  permanentRedirect('/control');
}
