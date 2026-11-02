'use client';

import { useLayoutEffect } from 'react';
import { useTripStore, type Viewport } from '@/store/useTripStore';

const QUERIES = {
  wide: '(min-width: 1280px)',
  desktop: '(min-width: 1024px)',
  tablet: '(min-width: 768px)',
} as const;

function readViewport(): Viewport {
  if (window.matchMedia(QUERIES.wide).matches) return 'wide';
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop';
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet';
  return 'mobile';
}

/**
 * Keeps `store.viewport` in sync with Tailwind's md / lg / xl breakpoints.
 * Reads `matchMedia` directly in a layout effect, before the first client paint,
 * so the layout never renders for a guessed size and then animates to the real one.
 */
export function useViewportSync(): void {
  const setViewport = useTripStore((s) => s.setViewport);

  useLayoutEffect(() => {
    const update = () => setViewport(readViewport());
    update();
    const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
    for (const list of lists) list.addEventListener('change', update);
    return () => {
      for (const list of lists) list.removeEventListener('change', update);
    };
  }, [setViewport]);
}
