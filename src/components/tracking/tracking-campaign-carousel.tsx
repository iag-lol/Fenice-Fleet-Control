'use client';

import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  ArrowUpRight,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/cn';
import type { TrackingContent } from '@/config/tracking-content';

export function TrackingCampaignCarousel({
  content,
}: {
  content: TrackingContent;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState<string[]>([]);
  const slides = content.enabled
    ? content.slides.filter(
        (slide) => slide.enabled && !failed.includes(slide.imageUrl),
      )
    : [];
  const slideKey = slides.map((slide) => slide.id).join('|');
  const activeIndex = slides.length ? index % slides.length : 0;
  const autoPlay = !paused && !hovered && !focused && !reducedMotion && visible;
  useEffect(() => {
    setIndex(0);
  }, [slideKey]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReducedMotion(media.matches);
    const visibility = () => setVisible(!document.hidden);
    motion();
    visibility();
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!autoPlay || slides.length < 2) return;
    const timer = setInterval(
      () => setIndex((value) => (value + 1) % slides.length),
      content.intervalSeconds * 1000,
    );
    return () => clearInterval(timer);
  }, [autoPlay, content.intervalSeconds, slides.length]);

  if (!slides.length)
    return (
      <section
        className="tracking-brand-panel relative flex min-h-[150px] flex-1 flex-col justify-end overflow-hidden rounded-2xl bg-[#102e32] p-5 text-white md:min-h-0"
        aria-label="Fenice, contigo en cada kilómetro"
      >
        <div
          aria-hidden
          className="absolute -right-16 -top-12 h-56 w-56 rounded-full border-[28px] border-white/5"
        />
        <div
          aria-hidden
          className="absolute right-8 top-8 h-3 w-3 rounded-full bg-[#8de3c6] shadow-[0_0_0_12px_rgba(141,227,198,.09)]"
        />
        <p className="relative text-[10px] font-semibold uppercase tracking-[.22em] text-[#91b9b6]">
          Fenice · Cerca de ti
        </p>
        <p className="relative mt-2 max-w-[240px] text-xl font-medium leading-tight tracking-tight">
          Contigo en cada
          <br />
          kilómetro.
        </p>
        <p className="relative mt-3 text-[11px] text-[#b5d0cd]">
          Tu entrega, siempre a la vista.
        </p>
      </section>
    );

  return (
    <section
      aria-label="Novedades Fenice"
      aria-roledescription="carrusel"
      className="flex min-h-[190px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white md:min-h-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
    >
      <div className="tracking-campaign-head flex shrink-0 items-center justify-between px-3.5 py-2">
        <p className="text-[11px] font-semibold text-slate-600">
          De Fenice para ti
        </p>
        <span className="text-[9px] uppercase tracking-wider text-slate-400">
          Publicidad
        </span>
      </div>
      <div
        className="relative min-h-[100px] flex-1 bg-[#edf4f1] md:min-h-0"
        aria-live="off"
      >
        {slides.map((slide, i) => {
          const image = (
            <Image
              fill
              unoptimized
              sizes="(min-width: 1280px) 320px, (min-width: 768px) 300px, 100vw"
              src={slide.imageUrl}
              alt={slide.title}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
              onError={() =>
                setFailed((value) =>
                  value.includes(slide.imageUrl)
                    ? value
                    : [...value, slide.imageUrl],
                )
              }
            />
          );
          return (
            <div
              key={slide.id}
              aria-hidden={i !== activeIndex}
              className={cn(
                'absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none',
                i === activeIndex
                  ? 'z-10 opacity-100'
                  : 'pointer-events-none opacity-0',
              )}
            >
              {slide.linkUrl ? (
                <a
                  href={slide.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  tabIndex={i === activeIndex ? 0 : -1}
                  className="block h-full w-full"
                  aria-label={`${slide.title} (abre otra pestaña)`}
                >
                  {image}
                  <ArrowUpRight className="absolute right-2 top-2 h-5 w-5 rounded bg-white/90 p-0.5 text-slate-700" />
                </a>
              ) : (
                image
              )}
            </div>
          );
        })}
      </div>
      <div className="tracking-campaign-controls flex shrink-0 items-center justify-between gap-1 px-2 py-1.5">
        <span className="min-w-0 truncate pl-1.5 text-[10px] text-slate-500">
          {slides[activeIndex]?.title}
        </span>
        {slides.length > 1 ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="Imagen anterior"
              onClick={() =>
                setIndex((activeIndex + slides.length - 1) % slides.length)
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="numeric text-[9px] text-slate-400">
              {activeIndex + 1}/{slides.length}
            </span>
            <button
              type="button"
              aria-label="Imagen siguiente"
              onClick={() => setIndex((activeIndex + 1) % slides.length)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <ChevronRight size={14} />
            </button>
            <button
              type="button"
              aria-label={
                paused
                  ? 'Activar rotación de imágenes'
                  : 'Pausar rotación de imágenes'
              }
              aria-pressed={paused}
              onClick={() => setPaused((value) => !value)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
