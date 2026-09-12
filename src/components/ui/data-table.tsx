'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface Column<T> {
  key: string;
  header: string;
  /** Contenido de la celda en escritorio. */
  cell: (row: T) => ReactNode;
  /** Valor usado para ordenar. Si se omite la columna no es ordenable. */
  sortValue?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
  /** Oculta la columna bajo el ancho indicado. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Tarjeta usada en movil: las tablas densas no se comprimen, se re-disenan. */
  mobileCard: (row: T) => ReactNode;
  empty: ReactNode;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  className?: string;
}

const HIDE_CLASS: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

/**
 * Tabla de datos con ordenamiento y presentacion adaptativa.
 *
 * En pantallas menores a `md` no se muestra una tabla comprimida sino una
 * lista de tarjetas: una tabla de 8 columnas es ilegible en 375 px.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  mobileCard,
  empty,
  initialSort,
  className,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortValue) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right), 'es') * factor;
    });
  }, [rows, columns, sort]);

  const toggleSort = (key: string): void => {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  };

  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className={className}>
      {/* --- Movil: tarjetas --- */}
      <ul className="divide-y divide-line md:hidden">
        {sortedRows.map((row) => (
          <li key={rowKey(row)}>
            {onRowClick ? (
              <button
                type="button"
                onClick={() => onRowClick(row)}
                className="w-full px-4 py-3 text-left transition-colors active:bg-surface-800"
              >
                {mobileCard(row)}
              </button>
            ) : (
              <div className="px-4 py-3">{mobileCard(row)}</div>
            )}
          </li>
        ))}
      </ul>

      {/* --- Escritorio: tabla --- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface-800/60">
              {columns.map((column) => {
                const sortable = Boolean(column.sortValue);
                const isSorted = sort?.key === column.key;

                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5 text-2xs font-semibold uppercase tracking-wider text-ink-faint',
                      column.hideBelow && HIDE_CLASS[column.hideBelow],
                      column.headerClassName,
                    )}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1 transition-colors hover:text-ink',
                          isSorted && 'text-brand-700',
                        )}
                      >
                        {column.header}
                        {isSorted ? (
                          sort.direction === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {sortedRows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-l-2 border-l-transparent transition-colors',
                  onRowClick && 'cursor-pointer hover:border-l-brand-500 hover:bg-brand-500/[0.04]',
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'px-3 py-2.5 align-middle text-[13px] text-ink',
                      column.hideBelow && HIDE_CLASS[column.hideBelow],
                      column.className,
                    )}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
