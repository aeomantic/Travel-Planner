'use client';

import { useEffect, useState } from 'react';
import { searchPlaces, type PlaceResult } from '@/lib/geocode';

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

interface Options {
  near?: { lat: number; lng: number };
  citiesOnly?: boolean;
  enabled?: boolean;
  debounceMs?: number;
}

/** Debounced, abortable place search. Stale responses are discarded. */
export function usePlaceSearch(query: string, options: Options = {}): { results: PlaceResult[]; status: SearchStatus } {
  const { near, citiesOnly = false, enabled = true, debounceMs = 300 } = options;
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const nearLat = near?.lat;
  const nearLng = near?.lng;

  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    const timer = window.setTimeout(() => {
      const bias = nearLat !== undefined && nearLng !== undefined ? { lat: nearLat, lng: nearLng } : undefined;
      searchPlaces(q, { near: bias, citiesOnly, signal: controller.signal })
        .then((found) => {
          setResults(found);
          setStatus('done');
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setStatus('error');
        });
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled, citiesOnly, nearLat, nearLng, debounceMs]);

  return { results, status };
}
