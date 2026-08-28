'use client';

import { AlertTriangle, Building2, Eye, EyeOff, Filter, Package, Truck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Stat } from '@/components/common/kpi';
import { Button } from '@/components/ui/button';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { CommuneOperationalSummary } from '@/services/aggregation/commune-aggregator';
import { useMapStore } from '@/stores/map-store';

export interface CommuneWithSummary {
  code: string;
  name: string;
  region: string;
  center: { lat: number; lng: number };
  boundary: { lat: number; lng: number }[];
  summary: CommuneOperationalSummary | null;
}

/**
 * Panel territorial de una comuna.
 *
 * Se abre al pulsar un limite comunal en el mapa. Todas las cifras se
 * resolvieron por geometria en el servidor, no por el texto de la direccion.
 */
export function CommunePanel({
  commune,
  onClose,
}: {
  commune: CommuneWithSummary;
  onClose: () => void;
}) {
  const router = useRouter();
  const filters = useMapStore((s) => s.filters);
  const setFilters = useMapStore((s) => s.setFilters);
  const focusOn = useMapStore((s) => s.focusOn);
  const scopedCommuneCode = useMapStore((s) => s.scopedCommuneCode);
  const scopeToCommune = useMapStore((s) => s.scopeToCommune);

  const summary = commune.summary;
  const isFiltered = filters.communeCodes.includes(commune.code);
  const enfocada = scopedCommuneCode === commune.code;

  const toggleFilter = (): void => {
    setFilters({
      communeCodes: isFiltered
        ? filters.communeCodes.filter((c) => c !== commune.code)
        : [...filters.communeCodes, commune.code],
    });
  };

  const coverage =
    summary && summary.clients > 0 ? summary.activeClients / summary.clients : null;

  return (
    <div className="pointer-events-auto w-[300px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg border border-line-strong bg-surface-900/98 shadow-panel backdrop-blur">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3.5 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{commune.name}</p>
          <p className="numeric truncate text-2xs text-ink-faint">
            Codigo DPA {commune.code}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar panel de comuna"
          className="-mr-1 shrink-0 rounded p-1 text-ink-faint transition-colors hover:bg-surface-800 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {summary === null ? (
        <p className="px-3.5 py-5 text-xs leading-relaxed text-ink-faint">
          Sin operacion registrada en esta comuna. Es una zona sin presencia comercial:
          la vista territorial la senala como oportunidad.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 px-3.5 py-3">
            <Stat label="Clientes" value={formatNumber(summary.clients)} />
            <Stat
              label="Cobertura"
              value={coverage === null ? '--' : formatPercent(coverage)}
              tone={
                coverage === null
                  ? 'neutral'
                  : coverage >= 0.6
                    ? 'active'
                    : coverage >= 0.4
                      ? 'warning'
                      : 'danger'
              }
            />
          </div>

          {/* Composicion de la cartera de un vistazo. */}
          <div className="px-3.5 pb-3">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-750">
              {(
                [
                  ['bg-status-active', summary.activeClients],
                  ['bg-status-warning', summary.warningClients],
                  ['bg-status-dormant', summary.dormantClients],
                ] as const
              ).map(([color, value]) => (
                <div
                  key={color}
                  className={color}
                  style={{
                    width: `${summary.clients === 0 ? 0 : (value / summary.clients) * 100}%`,
                  }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-2xs text-ink-faint">
              <span className="text-status-active">{summary.activeClients} activos</span>
              <span className="text-status-warning">{summary.warningClients} observacion</span>
              <span className="text-status-dormant">{summary.dormantClients} dormidos</span>
            </div>
          </div>

          <ul className="divide-y divide-line border-y border-line">
            <CommuneRow
              icon={<Truck className="h-3.5 w-3.5" />}
              label="Camiones en la comuna"
              value={summary.vehiclesInside}
            />
            <CommuneRow
              icon={<Package className="h-3.5 w-3.5" />}
              label="Despachos hoy"
              value={summary.workOrdersToday}
              detail={`${summary.deliveredToday} entregados · ${summary.pendingToday} pendientes`}
            />
            <CommuneRow
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              label="Alertas abiertas"
              value={summary.openAlerts}
              tone={summary.openAlerts > 0 ? 'warning' : 'neutral'}
            />
          </ul>
        </>
      )}

      <div className="space-y-2 p-3">
        {/*
          Enfocar la comuna deja en el mapa SOLO lo que hay dentro de su
          limite oficial: clientes, ordenes de trabajo, vehiculos y rutas. Se
          resuelve por geometria, no por el codigo de comuna guardado en cada
          ficha, para que un vehiculo en movimiento cuente donde esta de
          verdad y no donde estaba asignado.
        */}
        <Button
          block
          size="sm"
          variant={enfocada ? 'primary' : 'secondary'}
          icon={enfocada ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          onClick={() => {
            scopeToCommune(enfocada ? null : commune.code);
            if (!enfocada) focusOn(commune.center, 12);
          }}
        >
          {enfocada ? 'Dejar de ver solo esta comuna' : 'Ver solo esta comuna'}
        </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant={isFiltered ? 'primary' : 'secondary'}
          icon={<Filter className="h-3.5 w-3.5" />}
          onClick={toggleFilter}
        >
          {isFiltered ? 'Quitar filtro' : 'Filtrar'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon={<Building2 className="h-3.5 w-3.5" />}
          onClick={() => {
            focusOn(commune.center, 12);
            router.push(`/territorio?comuna=${encodeURIComponent(commune.code)}`);
          }}
        >
          Ver detalle
        </Button>
      </div>
      </div>
    </div>
  );
}

function CommuneRow({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail?: string;
  tone?: 'neutral' | 'warning';
}) {
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-2.5">
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink">{label}</span>
        {detail ? <span className="block truncate text-2xs text-ink-faint">{detail}</span> : null}
      </span>
      <span
        className={cn(
          'numeric shrink-0 text-sm font-medium',
          tone === 'warning' && value > 0 ? 'text-status-warning' : 'text-ink',
        )}
      >
        {value}
      </span>
    </li>
  );
}
