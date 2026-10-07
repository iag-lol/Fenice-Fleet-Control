'use client';
import { useMemo } from 'react';
import type { ReplayTimeline } from '@/lib/engines/route-replay';
import {
  buildSpeedProfile,
  type JourneyGap,
} from '@/lib/engines/journey-analysis';
import { formatTimeWithSeconds } from '@/lib/format';

export function JourneySpeedChart({
  timeline,
  gaps,
  maximum,
  limit,
  at,
  onSeek,
}: {
  timeline: ReplayTimeline;
  gaps: JourneyGap[];
  maximum: number;
  limit: number;
  at: number;
  onSeek: (time: number) => void;
}) {
  const height = Math.max(80, limit + 15, Math.ceil(maximum / 20) * 20);
  const lines = useMemo(
    () =>
      buildSpeedProfile(timeline).map((samples) =>
        samples
          .map(
            (sample) =>
              `${((Date.parse(sample.timestamp) - timeline.startMs) / timeline.durationMs) * 1000},${90 - (sample.speed / height) * 80}`,
          )
          .join(' '),
      ),
    [timeline, height],
  );
  const progress = (at - timeline.startMs) / timeline.durationMs;
  return (
    <div className="relative h-[90px] overflow-hidden rounded-lg bg-surface-850">
      <svg
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label="Velocidad registrada durante el recorrido"
      >
        {[30, 60].map((value) => (
          <line
            key={value}
            x1="0"
            x2="1000"
            y1={90 - (value / height) * 80}
            y2={90 - (value / height) * 80}
            stroke="#dce4eb"
            strokeWidth="1"
          />
        ))}
        {gaps.map((gap) => (
          <rect
            key={gap.from}
            x={
              ((Date.parse(gap.from) - timeline.startMs) /
                timeline.durationMs) *
              1000
            }
            y="0"
            width={
              ((Date.parse(gap.to) - Date.parse(gap.from)) /
                timeline.durationMs) *
              1000
            }
            height="100"
            fill="#fbbf24"
            fillOpacity=".12"
          />
        ))}
        <line
          x1="0"
          x2="1000"
          y1={90 - (limit / height) * 80}
          y2={90 - (limit / height) * 80}
          stroke="#ef4444"
          strokeWidth="1"
          strokeDasharray="5 5"
        />
        {lines.map((points, index) => (
          <polyline
            key={index}
            points={points}
            fill="none"
            stroke="#0891b2"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          x1={Math.min(999, Math.max(1, progress * 1000))}
          x2={Math.min(999, Math.max(1, progress * 1000))}
          y1="0"
          y2="100"
          stroke="#102b46"
          strokeWidth="2"
        />
      </svg>
      <span className="pointer-events-none absolute left-1 top-0 rounded bg-surface-850/80 px-1 text-[9px] text-ink-faint">
        {height} km/h
      </span>
      <input
        aria-label="Instante del recorrido GPS"
        aria-valuetext={formatTimeWithSeconds(new Date(at).toISOString())}
        type="range"
        min={0}
        max={timeline.durationMs}
        step={1000}
        value={at - timeline.startMs}
        onChange={(e) => onSeek(timeline.startMs + Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-crosshair opacity-0 focus-visible:opacity-30"
      />
    </div>
  );
}
