import {
  Camera,
  CameraOff,
  CircleDot,
  RefreshCw,
  ShieldCheck,
  Video,
  WifiOff,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

export type VehicleCameraStatus = 'live' | 'connecting' | 'offline';

export interface VehicleCameraFeed {
  id: string;
  name: string;
  placement: string;
  channel: string;
  status: VehicleCameraStatus;
  streamUrl?: string | null;
  lastSignalAt?: string | null;
}

const DEFAULT_FEEDS: VehicleCameraFeed[] = [
  {
    id: 'cabin',
    name: 'Cámara de cabina',
    placement: 'Interior · Vista del conductor',
    channel: 'CANAL 01',
    status: 'offline',
  },
  {
    id: 'loading-station',
    name: 'Estación de carga',
    placement: 'Exterior · Zona de operación',
    channel: 'CANAL 02',
    status: 'offline',
  },
];

const STATUS_LABEL: Record<VehicleCameraStatus, string> = {
  live: 'En vivo',
  connecting: 'Conectando',
  offline: 'Desconectada',
};

function CameraFeedCard({ camera, vehicleLabel }: { camera: VehicleCameraFeed; vehicleLabel: string }) {
  const hasLiveStream = camera.status === 'live' && Boolean(camera.streamUrl);

  return (
    <article className="overflow-hidden rounded-lg border border-slate-800 bg-[#071116] shadow-[0_8px_24px_rgba(8,20,28,0.16)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0b1820] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Video className="h-3.5 w-3.5 shrink-0 text-cyan-300" aria-hidden />
          <div className="min-w-0">
            <h3 className="truncate text-xs font-semibold text-white">{camera.name}</h3>
            <p className="truncate text-[10px] text-slate-400">{camera.placement}</p>
          </div>
        </div>

        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.08em]',
            camera.status === 'live'
              ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
              : camera.status === 'connecting'
                ? 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                : 'border-red-400/30 bg-red-400/10 text-red-300',
          )}
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              camera.status === 'live'
                ? 'bg-emerald-300'
                : camera.status === 'connecting'
                  ? 'animate-pulse bg-amber-200'
                  : 'bg-red-300',
            )}
          />
          {STATUS_LABEL[camera.status]}
        </span>
      </div>

      <div className="relative aspect-video overflow-hidden bg-[#050b0f]">
        {hasLiveStream ? (
          <video
            src={camera.streamUrl ?? undefined}
            className="h-full w-full object-cover"
            aria-label={`${camera.name} de ${vehicleLabel}`}
            autoPlay
            muted
            playsInline
            controls
          />
        ) : (
          <>
            <div
              className="absolute inset-0 opacity-[0.08]"
              aria-hidden
              style={{
                backgroundImage:
                  'linear-gradient(rgba(103,232,249,.22) 1px, transparent 1px), linear-gradient(90deg, rgba(103,232,249,.22) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(14,116,144,0.12),transparent_58%)]" aria-hidden />

            <div className="absolute left-3 top-3 flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.12em] text-slate-500">
              <CircleDot className="h-3 w-3" aria-hidden />
              Sin señal
            </div>
            <div className="numeric absolute right-3 top-3 text-[9px] text-slate-600">--:--:--</div>

            <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 shadow-inner">
                <CameraOff className="h-5 w-5" aria-hidden />
              </span>
              <p className="mt-3 text-xs font-semibold text-slate-200">Cámara desconectada</p>
              <p className="mt-1 max-w-[230px] text-[10px] leading-relaxed text-slate-500">
                No hay transmisión en vivo disponible para este canal.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-[#0b1820] px-3 py-2 text-[9px] uppercase tracking-[0.1em] text-slate-500">
        <span className="numeric">{camera.channel}</span>
        <span>{camera.lastSignalAt ? `Última señal ${camera.lastSignalAt}` : 'Última señal no disponible'}</span>
      </div>
    </article>
  );
}

export function VehicleCameras({
  vehicleLabel,
  feeds = DEFAULT_FEEDS,
  compact = false,
  onRefresh,
}: {
  vehicleLabel: string;
  feeds?: VehicleCameraFeed[];
  compact?: boolean;
  onRefresh?: () => void;
}) {
  const disconnected = feeds.filter((camera) => camera.status === 'offline').length;
  const live = feeds.filter((camera) => camera.status === 'live' && camera.streamUrl).length;
  const allDisconnected = disconnected === feeds.length;

  return (
    <section className="overflow-hidden rounded-[10px] border border-line bg-surface-900 shadow-card" aria-labelledby="vehicle-cameras-title">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-3.5 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700 ring-1 ring-brand-500/15">
            <Camera className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="vehicle-cameras-title" className="text-sm font-semibold text-ink">
              Cámaras del vehículo
            </h2>
            <p className="mt-0.5 text-2xs text-ink-faint">
              Monitoreo de cabina y estación de carga · {vehicleLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold',
              live > 0
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700',
            )}
          >
            {live > 0 ? <Video className="h-3 w-3" aria-hidden /> : <WifiOff className="h-3 w-3" aria-hidden />}
            {live > 0 ? `${live} en vivo` : `${disconnected} sin conexión`}
          </span>
          {onRefresh ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={onRefresh}
              title="Actualizar estado de cámaras"
              aria-label="Actualizar estado de cámaras"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>

      <div className={cn('space-y-3 p-3.5', compact && 'p-3')}>
        <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5" role="status" aria-live="polite">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-700">
              {allDisconnected
                ? 'Las cámaras están desconectadas'
                : live > 0
                  ? 'Monitoreo de cámaras activo'
                  : 'Conectando con los canales de video'}
            </p>
            <p className="mt-0.5 text-2xs leading-relaxed text-slate-500">
              {allDisconnected
                ? 'No hay transmisión en vivo disponible. Cuando los equipos sean instalados, la señal aparecerá automáticamente en estos canales.'
                : live > 0
                  ? `${live} de ${feeds.length} canales transmitiendo. Los canales sin señal seguirán intentando reconectarse.`
                  : 'Los equipos están negociando la conexión. La transmisión aparecerá automáticamente cuando exista señal.'}
            </p>
          </div>
        </div>

        <div className={cn('grid gap-3', compact ? 'grid-cols-1' : 'md:grid-cols-2')}>
          {feeds.map((camera) => (
            <CameraFeedCard key={camera.id} camera={camera} vehicleLabel={vehicleLabel} />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-700" aria-hidden />
            Acceso operacional restringido · transmisión cifrada
          </span>
          <span className="numeric flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 rounded-full', live > 0 ? 'bg-status-active' : 'bg-status-offline')} />
            {live} de {feeds.length} canales en línea
          </span>
        </div>
      </div>
    </section>
  );
}
