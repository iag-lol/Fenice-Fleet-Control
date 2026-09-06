'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AlertsBell } from '@/components/shell/alerts-bell';
import { GlobalSearch } from '@/components/shell/global-search';
import { GpsStatusIndicator } from '@/components/shell/gps-status';
import { ALL_NAV_ITEMS, isActivePath } from '@/components/shell/navigation';
import { MobileNav } from '@/components/shell/mobile-nav';
import { BrandMark } from '@/components/shell/brand';
import { UserMenu } from '@/components/shell/user-menu';
import { formatTimeWithSeconds } from '@/lib/format';

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

  if (!now) return <span className="numeric w-[62px] text-xs text-ink-faint" />;

  return (
    <span className="numeric hidden text-xs tabular-nums text-ink-muted xl:inline" title="Hora local">
      {formatTimeWithSeconds(now)}
    </span>
  );
}

export function Header() {
  const title = useContextTitle();

  return (
    <header className="safe-top sticky top-0 z-30 border-b border-line bg-surface-900/95 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:gap-3 sm:px-4">
        <MobileNav />

        <span className="md:hidden">
          <BrandMark className="h-7 w-7" />
        </span>

        <h1 className="hidden min-w-0 shrink-0 truncate text-sm font-semibold text-ink md:block lg:w-[200px]">
          {title}
        </h1>

        <GlobalSearch className="mx-auto hidden w-full max-w-xl sm:block" />

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ControlClock />
          <GpsStatusIndicator />
          <AlertsBell />
          <UserMenu />
        </div>
      </div>

      {/* En movil el buscador ocupa su propia fila: comprimirlo lo haria inusable. */}
      <div className="border-t border-line px-3 py-2 sm:hidden">
        <GlobalSearch />
      </div>
    </header>
  );
}
