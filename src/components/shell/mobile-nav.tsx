'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Menu, Radio, X } from 'lucide-react';
import { useEffect } from 'react';

import { BrandLockup } from '@/components/shell/brand';
import { useMobileMenu } from '@/components/shell/mobile-menu-store';
import { getMobilePrimary, getVisibleNavGroups, isActivePath } from '@/components/shell/navigation';
import { cn } from '@/lib/cn';

/**
 * Navegacion movil.
 *
 * Dos piezas complementarias:
 *
 *  - La barra inferior, con los tres destinos de uso constante mas un boton
 *    "Mas" que abre el resto. Antes el menu completo solo estaba en el icono
 *    del encabezado, que pasaba desapercibido: la navegacion entera quedaba
 *    escondida detras de un boton que nadie encontraba.
 *  - Una hoja deslizante desde abajo con la navegacion completa. Se abre
 *    desde abajo y no desde el lateral porque en un telefono el pulgar llega
 *    a la parte inferior, no a la esquina superior izquierda.
 */

/** Boton del encabezado. Abre la misma hoja que el boton "Mas". */
export function MobileNav() {
  const setOpen = useMobileMenu((s) => s.setOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Abrir menu"
      className="tap flex items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-800 hover:text-ink md:hidden"
    >
      <Menu className="h-5 w-5" />
    </button>
  );
}

/** Hoja con la navegacion completa. Se monta una sola vez, en el armazon. */
export function MobileMenuSheet() {
  const pathname = usePathname();
  const open = useMobileMenu((s) => s.open);
  const setOpen = useMobileMenu((s) => s.setOpen);

  // Cerrar al navegar: en movil la hoja taparia la pagina destino.
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Menu principal"
    >
      <button
        type="button"
        aria-label="Cerrar menu"
        onClick={() => setOpen(false)}
        className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]"
      />

      <div className="absolute inset-x-0 bottom-0 flex max-h-[88vh] animate-fade-in flex-col rounded-t-2xl border-t border-line bg-surface-900 shadow-panel">
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <BrandLockup />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="flex h-11 w-11 items-center justify-center rounded-md text-ink-faint hover:bg-surface-800 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
          {getVisibleNavGroups().map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="mb-1.5 px-1 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                {group.label}
              </p>
              {/* Rejilla de dos columnas: cabe el doble de destinos sin
                  obligar a desplazarse, y cada objetivo sigue siendo grande. */}
              <ul className="grid grid-cols-2 gap-2">
                {group.items.map((item) => {
                  const active = isActivePath(pathname, item);
                  const Icon = item.icon;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex min-h-[68px] flex-col justify-center gap-1 rounded-lg border px-3 py-2.5 transition-colors',
                          active
                            ? 'border-brand-500 bg-brand-500/10'
                            : 'border-line bg-surface-800 active:bg-surface-750',
                        )}
                      >
                        <Icon
                          className={cn('h-5 w-5', active ? 'text-brand-700' : 'text-ink-faint')}
                        />
                        <span
                          className={cn(
                            'truncate text-[13px] leading-tight',
                            active ? 'font-semibold text-brand-700' : 'text-ink',
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="safe-bottom border-t border-line p-3">
          <Link
            href="/seguimiento"
            className="flex min-h-11 items-center gap-3 rounded-md px-2 text-sm text-ink-muted active:bg-surface-800"
          >
            <Radio className="h-5 w-5 text-ink-faint" />
            Seguimiento publico
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Barra inferior.
 *
 * Tres destinos constantes y un cuarto boton que abre el resto. Reservar un
 * hueco fijo para "Mas" evita que la navegacion completa dependa de que el
 * operador descubra el icono del encabezado.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const setOpen = useMobileMenu((s) => s.setOpen);
  const menuOpen = useMobileMenu((s) => s.open);
  const items = getMobilePrimary().slice(0, 3);

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-900/95 backdrop-blur-sm md:hidden"
      aria-label="Accesos rapidos"
    >
      <ul className="grid grid-cols-4">
        {items.map((item) => {
          const active = isActivePath(pathname, item) && !menuOpen;
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[54px] flex-col items-center justify-center gap-1 px-1 py-1.5 transition-colors',
                  active ? 'text-brand-700' : 'text-ink-faint active:text-ink',
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] leading-none">{item.label.split(' ')[0]}</span>
              </Link>
            </li>
          );
        })}

        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ver el resto del menu"
            aria-expanded={menuOpen}
            className={cn(
              'flex min-h-[54px] w-full flex-col items-center justify-center gap-1 px-1 py-1.5 transition-colors',
              menuOpen ? 'text-brand-700' : 'text-ink-faint active:text-ink',
            )}
          >
            <LayoutGrid className="h-5 w-5" />
            <span className="text-[10px] leading-none">Mas</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
