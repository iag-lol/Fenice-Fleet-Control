'use client';

import { Download, X } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Instalacion de la aplicacion y arranque sin conexion.
 *
 * Registra el trabajador de servicio y ofrece instalar cuando el navegador
 * avisa de que se puede. Funciona igual en telefono (pantalla de inicio) y
 * en escritorio (Chrome y Edge instalan como aplicacion de ventana propia).
 *
 * El aviso se ofrece UNA vez y se recuerda el rechazo: insistir en cada
 * visita es la forma mas rapida de que nadie vuelva a leerlo.
 */

const RECHAZO_KEY = 'fenice.instalacion.rechazada';

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function PwaProvider() {
  const [prompt, setPrompt] = useState<PromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    // Se registra tras la carga para no competir por ancho de banda con el
    // primer render, que es lo que el operador esta esperando.
    const registrar = (): void => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Sin trabajador la aplicacion funciona igual: solo se pierde el
        // arranque sin conexion. No es motivo para molestar a nadie.
      });
    };

    if (document.readyState === 'complete') registrar();
    else window.addEventListener('load', registrar, { once: true });
  }, []);

  useEffect(() => {
    const alInstalable = (event: Event): void => {
      // Sin esto el navegador muestra su propio aviso, que aparece donde
      // quiere y no explica que aporta instalar.
      event.preventDefault();
      setPrompt(event as PromptEvent);

      try {
        if (window.localStorage.getItem(RECHAZO_KEY) !== 'true') setVisible(true);
      } catch {
        setVisible(true);
      }
    };

    window.addEventListener('beforeinstallprompt', alInstalable);
    window.addEventListener('appinstalled', () => setVisible(false));
    return () => window.removeEventListener('beforeinstallprompt', alInstalable);
  }, []);

  const rechazar = (): void => {
    setVisible(false);
    try {
      window.localStorage.setItem(RECHAZO_KEY, 'true');
    } catch {
      // Sin almacenamiento volvera a ofrecerse; es el mal menor.
    }
  };

  if (!visible || !prompt) return null;

  return (
    <div className="absolute inset-x-3 bottom-[70px] z-[45] sm:inset-x-auto sm:bottom-4 sm:left-4 sm:w-[360px]">
      <div
        role="status"
        aria-live="polite"
        className="relative overflow-hidden rounded-xl border border-line-strong bg-surface-900 shadow-panel"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-brand-500" aria-hidden />

        <div className="flex items-start gap-3 py-3 pl-4 pr-12">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white shadow-card">
          <Download className="h-4.5 w-4.5" width={18} height={18} />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-5 text-ink">Instala Fenice</p>
            <p className="mt-0.5 text-xs leading-[1.45] text-ink-muted">
              Accede más rápido, a pantalla completa y con avisos del sistema.
            </p>
            <button
              type="button"
              onClick={() => {
                void prompt.prompt();
                void prompt.userChoice.finally(() => setVisible(false));
              }}
              className="mt-2 inline-flex min-h-11 items-center rounded-md bg-brand-600 px-4 text-xs font-semibold text-white transition-colors hover:bg-brand-700 sm:min-h-8 sm:px-3"
            >
              Instalar aplicación
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={rechazar}
          aria-label="Ahora no"
          title="Ahora no"
          className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-surface-800 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
