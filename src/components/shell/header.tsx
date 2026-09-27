'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PanelLeft } from 'lucide-react';

import { AlertsBell } from '@/components/shell/alerts-bell';
import { GlobalSearch } from '@/components/shell/global-search';
import { GpsStatusIndicator } from '@/components/shell/gps-status';
import { ALL_NAV_ITEMS, isActivePath } from '@/components/shell/navigation';
import { MobileNav } from '@/components/shell/mobile-nav';
import { BrandMark } from '@/components/shell/brand';
import { UserMenu } from '@/components/shell/user-menu';
import { useIsTabletRange } from '@/hooks/use-media-query';
import { formatTimeWithSeconds } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Titulo contextual a partir de la ruta activa. */
function useContextTitle(): string {
  const pathname = usePathname();

  const match = ALL_NAV_ITEMS.find((item) => isActivePath(pathname, item));
  if (match) return match.label;
  if (pathname.startsWith('/seguimiento')) return 'Seguimiento de pedido';
  return 'Fenice Fleet Control';
}

/** Reloj del centro de control. Se monta en cliente para evitar desajuste. */
function ControlClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return <span className="w-[86px]" />;

  const dateLabel = new Intl.DateTimeFormat('es-CL', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
    .format(now)
    .replace(/\.$/, '');

  return (
    <span className="hidden min-w-[94px] flex-col text-right xl:flex" title="Hora local">
      <span className="numeric text-xs font-semibold tabular-nums text-ink">{formatTimeWithSeconds(now)}</span>
      <span className="text-[10px] capitalize text-ink-faint">{dateLabel}</span>
    </span>
  );
}

export function Header() {
  const title = useContextTitle();
  const pathname = usePathname();
  const isControlTower = pathname?.startsWith('/control') ?? false;
  const isTabletRange = useIsTabletRange();

  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface-900/90 shadow-[0_1px_8px_rgba(20,35,46,0.025)] backdrop-blur-xl">
      <div className="flex h-[52px] items-center gap-2 px-3 sm:px-3.5">
        <MobileNav />

        {!isTabletRange ? (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event('fenice:toggle-sidebar'))}
            aria-label="Expandir o colapsar menu lateral"
            title="Expandir o colapsar menu lateral"
            className="app-sidebar-toggle hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-900 text-ink-faint shadow-card transition-colors hover:border-brand-400 hover:text-brand-700 xl:flex"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        ) : null}

        <span className="mobile-layout-inline md:hidden">
          <BrandMark className="h-7 w-7" />
        </span>

        <h1
          className={cn(
            'hidden min-w-0 max-w-[150px] shrink-0 truncate text-[13px] font-semibold text-ink xl:block',
            isControlTower && 'md:hidden',
          )}
        >
          {title}
        </h1>

        <GlobalSearch
          className={cn(
            'header-desktop-search mx-auto hidden w-full max-w-2xl sm:block',
            isControlTower && 'lg:max-w-4xl',
          )}
        />

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ControlClock />
          <GpsStatusIndicator />
          <AlertsBell />
          <UserMenu />
        </div>
      </div>

      {/* En movil el buscador ocupa su propia fila: comprimirlo lo haria inusable. */}
      <div className="header-mobile-search border-t border-line px-3 py-2 sm:hidden">
        <GlobalSearch />
      </div>
    </header>
  );
}
