'use client';

import { useEffect } from 'react';

/**
 * Instalacion como aplicacion.
 *
 * El portal se instala en el telefono del conductor para abrirse a pantalla
 * completa y sobrevivir a los cortes de red. El trabajador de servicio SOLO
 * cachea el armazon de la aplicacion: los datos de la ruta nunca se sirven
 * desde cache, porque una parada ya entregada mostrada como pendiente causa
 * una segunda visita.
 *
 * El registro se hace desde el portal y no en el arranque general para no
 * instalar nada en el navegador de la oficina.
 */
export function DriverPwa() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // `scope` limita el trabajador a las rutas del conductor: no debe
    // interceptar la aplicacion de escritorio ni el seguimiento publico.
    void navigator.serviceWorker.register('/conductor-sw.js', { scope: '/conductor/' }).catch(() => {
      // Sin trabajador de servicio el portal sigue funcionando: solo se pierde
      // el arranque sin conexion. No es motivo para molestar al conductor.
    });
  }, []);

  return <link rel="manifest" href="/conductor.webmanifest" />;
}
