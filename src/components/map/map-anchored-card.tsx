'use client';

import { Popup, type Map as MapLibreMap } from 'maplibre-gl';
import { createPortal } from 'react-dom';
import { useEffect, useState, type ReactNode } from 'react';
import type { LatLng } from '@/types/core';

/** A React card anchored to GPS coordinates, contained within the map viewport. */
export function MapAnchoredCard({ map, position, offset = 18, interactive = false, width, children }: {
  map: MapLibreMap; position: LatLng; offset?: number; interactive?: boolean; width?: number; children: (compact: boolean) => ReactNode;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = document.createElement('div');
    const popup = new Popup({ closeButton: false, closeOnClick: false, maxWidth: 'none', offset,
      anchor: interactive && map.getContainer().clientWidth >= 700 ? 'left' : undefined,
      className: interactive ? 'fleet-active-delivery-popup' : 'fleet-pin-popup', focusAfterOpen: false })
      .setLngLat([position.lng, position.lat]).setDOMContent(element).addTo(map);
    let disposed = false;
    const fit = () => {
      // ResizeObserver can deliver an already queued callback after removal.
      if (disposed || !popup.isOpen()) return;
      const popupElement = popup.getElement();
      if (!popupElement) return;
      const container = map.getContainer();
      setCompact(container.clientHeight < (interactive ? 480 : 320));
      element.style.transform = '';
      element.style.width = `${Math.max(180, Math.min(width ?? (interactive ? 330 : 300), container.clientWidth - 32))}px`;
      if (interactive) {
        element.style.maxHeight = `${Math.max(100, container.clientHeight - 16)}px`;
        element.style.overflowY = 'auto';
        element.style.borderRadius = '16px';
      }
      popup.setLngLat([position.lng, position.lat]);
      const anchor = map.project([position.lng, position.lat]);
      const inView = anchor.x >= 0 && anchor.x <= container.clientWidth && anchor.y >= 0 && anchor.y <= container.clientHeight;
      popupElement.style.visibility = interactive && !inView ? 'hidden' : 'visible';
      const bounds = container.getBoundingClientRect(), card = element.getBoundingClientRect();
      const dx = card.left < bounds.left + 8 ? bounds.left + 8 - card.left : card.right > bounds.right - 8 ? bounds.right - 8 - card.right : 0;
      const dy = card.top < bounds.top + 8 ? bounds.top + 8 - card.top : card.bottom > bounds.bottom - 8 ? bounds.bottom - 8 - card.bottom : 0;
      element.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    map.on('move', fit); map.on('resize', fit);
    setHost(element);
    fit();
    return () => { disposed = true; observer.disconnect(); map.off('move', fit); map.off('resize', fit); popup.remove(); setHost(null); };
  }, [map, position.lat, position.lng, interactive, offset, width]);
  return host ? createPortal(children(compact), host) : null;
}
