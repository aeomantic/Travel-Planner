'use client';

import { useSyncExternalStore } from 'react';
import type { Viewport } from '@/store/useTripStore';

const QUERIES = {
  wide: '(min-width: 1280px)',
  desktop: '(min-width: 1024px)',
  tablet: '(min-width: 768px)',
} as const;

function getSnapshot(): Viewport {
  if (window.matchMedia(QUERIES.wide).matches) return 'wide';
  if (window.matchMedia(QUERIES.desktop).matches) return 'desktop';
  if (window.matchMedia(QUERIES.tablet).matches) return 'tablet';
  return 'mobile';
}

function subscribe(onChange: () => void): () => void {
  const lists = Object.values(QUERIES).map((query) => window.matchMedia(query));
  for (const list of lists) list.addEventListener('change', onChange);
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange);
  };
}

/** Breakpoint bucket matching Tailwind's md / lg / xl. Server render assumes `wide`. */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, getSnapshot, () => 'wide');
}
