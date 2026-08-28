'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Radio, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BrandLockup } from '@/components/shell/brand';
import { getMobilePrimary, getVisibleNavGroups, isActivePath } from '@/components/shell/navigation';
import { cn } from '@/lib/cn';

/**
 * Navegacion movil.
 *
 * Dos piezas complementarias: una barra inferior con los cuatro destinos de
 * uso constante, y un menu deslizable con la navegacion completa. La barra
 * inferior respeta el area segura del dispositivo.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Cerrar el menu al navegar: en movil el panel taparia la pagina destino.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="tap flex items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-800 hover:text-ink md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-[60] md:hidden" role="dialog" aria-modal="true" aria-label="Menu principal">
          <button
            type="button"
            aria-label="Cerrar menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 animate-fade-in bg-overlay backdrop-blur-[2px]"
          />

          <div className="safe-top relative flex h-full w-[82%] max-w-[300px] animate-fade-in flex-col border-r border-line bg-surface-900">
            <div className="flex h-14 items-center justify-between gap-2 border-b border-line px-3">
              <BrandLockup />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="tap flex items-center justify-center rounded-md text-ink-faint hover:bg-surface-800 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {getVisibleNavGroups().map((group) => (
                <div key={group.label} className="mb-4">
                  <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                    {group.label}
                  </p>
                  <ul className="space-y-0.5">
                    {group.items.map((item) => {
                      const active = isActivePath(pathname, item);
                      const Icon = item.icon;

                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={cn(
                              'flex items-start gap-3 rounded-md px-2.5 py-2.5 transition-colors',
                              active ? 'bg-brand-500/15' : 'active:bg-surface-800',
                            )}
                          >
                            <Icon
                              className={cn(
                                'mt-0.5 h-4.5 w-4.5 shrink-0',
                                active ? 'text-brand-700' : 'text-ink-faint',
                              )}
                              width={18}
                              height={18}
                            />
                            <span className="min-w-0">
                              <span
                                className={cn(
                                  'block truncate text-sm',
                                  active ? 'font-medium text-brand-700' : 'text-ink',
                                )}
                              >
                                {item.label}
                              </span>
                              <span className="block truncate text-2xs text-ink-faint">{item.hint}</span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="safe-bottom border-t border-line p-2">
              <Link
                href="/seguimiento"
                className="flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm text-ink-muted active:bg-surface-800"
              >
                <Radio className="h-4.5 w-4.5 text-ink-faint" width={18} height={18} />
                Seguimiento publico
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Barra inferior de accesos rapidos. */
export function MobileTabBar() {
  const pathname = usePathname();
  const items = getMobilePrimary();

  return (
    <nav
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-900/95 backdrop-blur-sm md:hidden"
      aria-label="Accesos rapidos"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActivePath(pathname, item);
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
      </ul>
    </nav>
  );
}
