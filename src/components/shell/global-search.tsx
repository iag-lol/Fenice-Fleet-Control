'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Building2,
  ClipboardList,
  MapPin,
  Package,
  Route as RouteIcon,
  Search,
  Truck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { cn } from '@/lib/cn';
import { useMapStore } from '@/stores/map-store';
import type { GlobalSearchResult } from '@/types/views';

const KIND_ICON = {
  cliente: Building2,
  vehiculo: Truck,
  orden: ClipboardList,
  pedido: Package,
  ruta: RouteIcon,
  comuna: MapPin,
} as const;

const KIND_LABEL = {
  cliente: 'Cliente',
  vehiculo: 'Vehiculo',
  orden: 'Orden de trabajo',
  pedido: 'Pedido',
  ruta: 'Ruta',
  comuna: 'Comuna',
} as const;

/**
 * Buscador global. Cubre cliente, RUT, codigo, patente, OT, pedido, direccion
 * y comuna, y cada resultado ofrece navegar al detalle o abrirlo en el mapa.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebouncedValue(term, 220);
  const focusOn = useMapStore((s) => s.focusOn);
  const select = useMapStore((s) => s.select);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    enabled: debounced.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<{ results: GlobalSearchResult[] }> => {
      const response = await fetch(`/api/buscar?q=${encodeURIComponent(debounced)}`);
      if (!response.ok) throw new Error('Busqueda no disponible');
      return (await response.json()) as { results: GlobalSearchResult[] };
    },
  });

  const results = data?.results ?? [];

  useEffect(() => {
    setHighlight(0);
  }, [debounced]);

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Atajo global: Ctrl/Cmd + K.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const go = (result: GlobalSearchResult): void => {
    setOpen(false);
    setTerm('');
    router.push(result.href);
  };

  const showOnMap = (result: GlobalSearchResult): void => {
    setOpen(false);
    setTerm('');
    if (result.mapFocus) {
      select(
        result.mapFocus.type === 'commune'
          ? null
          : { type: result.mapFocus.type, id: result.mapFocus.id },
      );
    }
    if (result.position) focusOn(result.position, result.kind === 'comuna' ? 12.5 : 15);
    router.push('/control');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter') {
      const result = results[highlight];
      if (result) go(result);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <SearchInput
        ref={inputRef}
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onClear={() => setTerm('')}
        placeholder="Buscar cliente, patente, OT, pedido, direccion..."
        aria-label="Buscador global"
        className="bg-surface-850"
      />

      {open && term.trim().length >= 2 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1.5 max-h-[70vh] animate-slide-up overflow-y-auto rounded-lg border border-line-strong bg-surface-850 shadow-panel">
          {isFetching && results.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-faint">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-4 text-xs text-ink-faint">
              No encontramos coincidencias para &ldquo;{term}&rdquo;. Prueba con la patente, el codigo
              de cliente o el numero de OT.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {results.map((result, index) => {
                const Icon = KIND_ICON[result.kind];

                return (
                  <li
                    key={`${result.kind}-${result.id}`}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5',
                      index === highlight && 'bg-surface-800',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => go(result)}
                      onMouseEnter={() => setHighlight(index)}
                      className="flex min-w-0 flex-1 items-start gap-2.5 rounded px-1 py-1 text-left"
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-medium text-ink">
                            {result.title}
                          </span>
                          <span className="shrink-0 text-2xs text-ink-faint">
                            {KIND_LABEL[result.kind]}
                          </span>
                        </span>
                        <span className="block truncate text-2xs text-ink-faint">
                          {result.subtitle}
                        </span>
                      </span>
                    </button>

                    {result.position ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => showOnMap(result)}
                      >
                        Ver en mapa
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-2xs text-ink-faint">
            <Search className="h-3 w-3" />
            <span>Usa las flechas para navegar y Enter para abrir</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
