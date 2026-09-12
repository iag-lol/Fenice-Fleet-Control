'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PanelLeftClose, PanelLeftOpen, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';

import { BrandLockup } from '@/components/shell/brand';
import { getVisibleNavGroups, isActivePath } from '@/components/shell/navigation';
import { PlanBadge } from '@/components/product/plan-badge';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/cn';

/**
 * Barra lateral de escritorio.
 *
 * Se puede colapsar a iconos: en el mapa operacional cada pixel horizontal
 * cuenta, y el operador que ya conoce la navegacion no necesita las etiquetas.
 * La preferencia se recuerda entre sesiones.
 *
 * Sin preferencia guardada, el ancho se adapta solo en tablet (768-1023px):
 * el sidebar completo (236px) le restaba casi un tercio del ancho al mapa o
 * a las tablas en esa franja. Un usuario que expande o colapsa a mano fija su
 * eleccion para siempre, en cualquier ancho.
 */
const TABLET_RANGE_QUERY = '(min-width: 768px) and (max-width: 1023px)';

export function Sidebar() {
  const pathname = usePathname();
  const isTabletRange = useMediaQuery(TABLET_RANGE_QUERY);
  const [collapsed, setCollapsed] = useState(false);
  const [hasStoredPreference, setHasStoredPreference] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('fenice.sidebar.collapsed');
      if (stored !== null) {
        setCollapsed(stored === '1');
        setHasStoredPreference(true);
      }
    } catch {
      // Almacenamiento no disponible: se usa el valor por defecto.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasStoredPreference) setCollapsed(isTabletRange);
  }, [isTabletRange, hasStoredPreference]);

  const toggle = (): void => {
    setCollapsed((current) => {
      const next = !current;
      setHasStoredPreference(true);
      try {
        window.localStorage.setItem('fenice.sidebar.collapsed', next ? '1' : '0');
      } catch {
        // Sin persistencia: el cambio sigue aplicando en esta sesion.
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        'hidden h-app shrink-0 flex-col border-r border-line bg-surface-900 transition-[width] duration-200 md:flex',
        collapsed ? 'w-[68px]' : 'w-[236px]',
        !hydrated && 'invisible',
      )}
    >
      <div className={cn('flex h-14 items-center border-b border-line px-3', collapsed && 'justify-center px-2')}>
        <Link href="/" className="min-w-0 rounded" aria-label="Fenice Fleet Control - inicio">
          <BrandLockup compact={collapsed} />
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Navegacion principal">
        {getVisibleNavGroups().map((group) => (
          <div key={group.label} className="mb-4 last:mb-0">
            {!collapsed ? (
              <p className="mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                {group.label}
              </p>
            ) : (
              <div className="mx-2 mb-2 border-t border-line first:border-t-0" aria-hidden />
            )}

            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActivePath(pathname, item);
                const Icon = item.icon;

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                        collapsed && 'justify-center px-0',
                        active
                          ? 'bg-brand-500/15 font-medium text-brand-700'
                          : 'text-ink-muted hover:bg-surface-800 hover:text-ink',
                      )}
                    >
                      <Icon className={cn('h-4 w-4 shrink-0', active && 'text-brand-700')} />
                      {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      {!collapsed && item.featureId ? (
                        <span className="ml-auto shrink-0">
                          <PlanBadge featureId={item.featureId} />
                        </span>
                      ) : null}
                      {active && !collapsed && !item.featureId ? (
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        <Link
          href="/seguimiento"
          title="Seguimiento publico"
          className={cn(
            'mb-1 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink-muted transition-colors hover:bg-surface-800 hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          <Radio className="h-4 w-4 shrink-0" />
          {!collapsed ? <span className="truncate">Seguimiento publico</span> : null}
        </Link>

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expandir menu' : 'Colapsar menu'}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink-faint transition-colors hover:bg-surface-800 hover:text-ink',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" />
          )}
          {!collapsed ? <span>Colapsar</span> : null}
        </button>

        <a
          href="https://zyteron.cl"
          target="_blank"
          rel="noopener noreferrer"
          title="Desarrollado por Zyteron"
          className={cn(
            'mt-1 flex items-center justify-center gap-1.5 rounded-md px-2.5 py-2 text-2xs text-ink-faint transition-colors hover:bg-surface-800 hover:text-brand-700',
            collapsed ? 'px-0' : 'justify-start',
          )}
        >
          {!collapsed ? <span className="truncate">Desarrollado por Zyteron</span> : <span aria-hidden>Z</span>}
        </a>
      </div>
    </aside>
  );
}
