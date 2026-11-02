'use client';

import { useMemo } from 'react';
import type { BucketKey, Project, ProjectPin, TripDay } from '@/types/trip';
import { buildPinMeta, getTripDays, groupPinsByBucket, type PinDisplayMeta } from '@/lib/itinerary';
import { EMPTY_PINS, useTripStore } from '@/store/useTripStore';

export interface Itinerary {
  project: Project | undefined;
  pins: ProjectPin[];
  days: TripDay[];
  buckets: Map<BucketKey, ProjectPin[]>;
  meta: Map<string, PinDisplayMeta>;
}

/**
 * Derived, memoised view of a trip shared by the drawer and the map.
 * Takes an explicit id so the drawer can keep rendering a trip while it animates closed.
 */
export function useItinerary(projectId: string | null): Itinerary {
  const project = useTripStore((s) => (projectId ? s.projects.find((p) => p.id === projectId) : undefined));
  const pins = useTripStore((s) => (projectId ? s.pinsByProject[projectId] : undefined) ?? EMPTY_PINS);
  const startDate = project?.start_date;
  const endDate = project?.end_date;

  const days = useMemo(() => (startDate && endDate ? getTripDays(startDate, endDate) : []), [startDate, endDate]);
  const buckets = useMemo(() => groupPinsByBucket(pins, days), [pins, days]);
  const meta = useMemo(() => buildPinMeta(buckets, days), [buckets, days]);

  return { project, pins, days, buckets, meta };
}
