'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { playAlertSound } from '@/lib/alert-sound';
import type { Alert, AlertSeverity } from '@/types/core';

/**
 * Aviso de alertas nuevas.
 *
 * Vigila el centro de alertas y avisa SOLO de lo que aparece despues de
 * abrir la aplicacion. Si avisara de todo lo abierto, el operador recibiria
 * treinta avisos al entrar y desactivaria la funcion el primer dia.
 *
 * El aviso tiene tres canales, de menos a mas intrusivo:
 *   1. Tarjeta flotante dentro de la aplicacion (siempre).
 *   2. Sonido, distinto segun la gravedad (configurable).
 *   3. Notificacion del sistema operativo, que llega aunque la pestaña este
 *      en segundo plano (requiere permiso explicito).
 */

const PREFERENCIAS_KEY = 'fenice.alertas.avisos';
const POLL_MS = 30_000;
/** Nunca se muestran mas de estas a la vez: apiladas, dejan de leerse. */
const MAX_VISIBLES = 4;
/** Las criticas no se van solas: exigen que alguien las cierre. */
const AUTO_CIERRE_MS = 12_000;

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface AlertPreferences {
  sound: boolean;
  desktop: boolean;
  /** Gravedad minima que dispara un aviso. */
  minSeverity: AlertSeverity;
}

const PREFERENCIAS_POR_DEFECTO: AlertPreferences = {
  sound: true,
  desktop: false,
  minSeverity: 'warning',
};

const ORDEN: Record<AlertSeverity, number> = { info: 0, warning: 1, critical: 2 };

function leerPreferencias(): AlertPreferences {
  if (typeof window === 'undefined') return PREFERENCIAS_POR_DEFECTO;
  try {
    const crudo = window.localStorage.getItem(PREFERENCIAS_KEY);
    if (!crudo) return PREFERENCIAS_POR_DEFECTO;
    return { ...PREFERENCIAS_POR_DEFECTO, ...(JSON.parse(crudo) as Partial<AlertPreferences>) };
  } catch {
    return PREFERENCIAS_POR_DEFECTO;
  }
}

export interface AlertNotificationsState {
  /** Alertas que se estan mostrando como tarjeta flotante. */
  visible: Alert[];
  dismiss: (id: string) => void;
  dismissAll: () => void;
  preferences: AlertPreferences;
  setPreferences: (next: Partial<AlertPreferences>) => void;
  permission: NotificationPermissionState;
  requestPermission: () => Promise<void>;
}

export function useAlertNotifications(): AlertNotificationsState {
  const [visible, setVisible] = useState<Alert[]>([]);
  const [preferences, setPreferencesState] = useState<AlertPreferences>(PREFERENCIAS_POR_DEFECTO);
  const [permission, setPermission] = useState<NotificationPermissionState>('unsupported');

  /**
   * Alertas ya conocidas.
   *
   * Se siembra con la PRIMERA respuesta y no se avisa de ella: lo que ya
   * estaba abierto al entrar no es una novedad.
   */
  const conocidas = useRef<Set<string> | null>(null);
  const temporizadores = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setPreferencesState(leerPreferencias());
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission as NotificationPermissionState);
    }
  }, []);

  const setPreferences = useCallback((next: Partial<AlertPreferences>) => {
    setPreferencesState((actual) => {
      const combinado = { ...actual, ...next };
      try {
        window.localStorage.setItem(PREFERENCIAS_KEY, JSON.stringify(combinado));
      } catch {
        // Sin almacenamiento la preferencia dura lo que la sesion.
      }
      return combinado;
    });
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const resultado = await Notification.requestPermission();
      setPermission(resultado as NotificationPermissionState);
      if (resultado === 'granted') setPreferences({ desktop: true });
    } catch {
      // Un permiso denegado no es un fallo: el aviso visual sigue.
    }
  }, [setPreferences]);

  const dismiss = useCallback((id: string) => {
    setVisible((actuales) => actuales.filter((a) => a.id !== id));
    const temporizador = temporizadores.current.get(id);
    if (temporizador) {
      clearTimeout(temporizador);
      temporizadores.current.delete(id);
    }
  }, []);

  const dismissAll = useCallback(() => {
    for (const temporizador of temporizadores.current.values()) clearTimeout(temporizador);
    temporizadores.current.clear();
    setVisible([]);
  }, []);

  useEffect(() => {
    let cancelado = false;

    const revisar = async (): Promise<void> => {
      try {
        const respuesta = await fetch('/api/alertas?estado=open', { cache: 'no-store' });
        if (!respuesta.ok || cancelado) return;

        const { alerts } = (await respuesta.json()) as { alerts: Alert[] };

        // Primera lectura: se memoriza sin avisar.
        if (conocidas.current === null) {
          conocidas.current = new Set(alerts.map((a) => a.id));
          return;
        }

        const nuevas = alerts.filter((a) => !conocidas.current!.has(a.id));
        for (const alerta of alerts) conocidas.current.add(alerta.id);
        if (nuevas.length === 0) return;

        const relevantes = nuevas.filter(
          (a) => ORDEN[a.severity] >= ORDEN[preferences.minSeverity],
        );
        if (relevantes.length === 0) return;

        // La mas grave primero: si solo cabe una, que sea la que importa.
        relevantes.sort((a, b) => ORDEN[b.severity] - ORDEN[a.severity]);

        setVisible((actuales) => [...relevantes, ...actuales].slice(0, MAX_VISIBLES));

        const masGrave = relevantes[0]!;
        if (preferences.sound) playAlertSound(masGrave.severity);

        if (preferences.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          for (const alerta of relevantes.slice(0, 2)) {
            try {
              new Notification(alerta.title, {
                body: alerta.description,
                icon: '/icon-192.png',
                // La etiqueta evita apilar duplicados de la misma alerta.
                tag: alerta.id,
                requireInteraction: alerta.severity === 'critical',
              });
            } catch {
              // Algunos navegadores exigen crearlas desde el trabajador de
              // servicio; si falla, el aviso dentro de la aplicacion queda.
            }
          }
        }

        // Las criticas permanecen hasta que alguien las cierra.
        for (const alerta of relevantes) {
          if (alerta.severity === 'critical') continue;
          const temporizador = setTimeout(() => dismiss(alerta.id), AUTO_CIERRE_MS);
          temporizadores.current.set(alerta.id, temporizador);
        }
      } catch {
        // Sin red no se avisa; se reintenta en el siguiente ciclo.
      }
    };

    void revisar();
    const intervalo = window.setInterval(() => void revisar(), POLL_MS);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [dismiss, preferences.desktop, preferences.minSeverity, preferences.sound]);

  useEffect(() => {
    const pendientes = temporizadores.current;
    return () => {
      for (const temporizador of pendientes.values()) clearTimeout(temporizador);
      pendientes.clear();
    };
  }, []);

  return {
    visible,
    dismiss,
    dismissAll,
    preferences,
    setPreferences,
    permission,
    requestPermission,
  };
}
