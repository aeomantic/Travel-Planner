import { differenceInCalendarDays, eachDayOfInterval, format } from 'date-fns';
import {
  UNASSIGNED,
  type BucketKey,
  type DayFilter,
  type ISODate,
  type PinCategory,
  type ProjectPin,
  type TripDay,
} from '@/types/trip';
import { parseISODate, toISODate } from '@/lib/utils';

/** Hard cap so a typo'd end date can't generate thousands of accordions. */
export const MAX_TRIP_DAYS = 60;

export const DAY_COLORS = [
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Fuchsia', hex: '#d946ef' },
  { name: 'Lime', hex: '#84cc16' },
] as const;

export const UNASSIGNED_COLOR = '#64748b';

export function dayColor(zeroBasedIndex: number): string {
  return DAY_COLORS[zeroBasedIndex % DAY_COLORS.length]?.hex ?? UNASSIGNED_COLOR;
}

export const CATEGORY_LABELS: Record<PinCategory, string> = {
  sightseeing: 'Sightseeing',
  food: 'Food',
  hotel: 'Stay',
  transit: 'Transit',
  other: 'Other',
};

export const CATEGORY_COLORS: Record<PinCategory, string> = {
  sightseeing: '#818cf8',
  food: '#fb923c',
  hotel: '#c084fc',
  transit: '#38bdf8',
  other: '#94a3b8',
};

export function tripLength(start: ISODate, end: ISODate): number {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e) return 0;
  return differenceInCalendarDays(e, s) + 1;
}

/** Days are never stored: they're derived from the project's date range. */
export function getTripDays(start: ISODate, end: ISODate): TripDay[] {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e || e < s) return [];
  const length = tripLength(start, end);
  if (length > MAX_TRIP_DAYS) return [];
  return eachDayOfInterval({ start: s, end: e }).map((date, i) => ({
    date: toISODate(date),
    index: i + 1,
    label: format(date, 'EEE, MMM d'),
    color: dayColor(i),
  }));
}

export function bySortOrder(a: ProjectPin, b: ProjectPin): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

/**
 * Groups pins into ordered buckets: one per trip day plus Saved Places.
 * Pins whose `day_date` falls outside the trip range are surfaced in Saved Places
 * so they never silently disappear.
 */
export function groupPinsByBucket(pins: ProjectPin[], days: TripDay[]): Map<BucketKey, ProjectPin[]> {
  const buckets = new Map<BucketKey, ProjectPin[]>();
  buckets.set(UNASSIGNED, []);
  for (const day of days) buckets.set(day.date, []);
  for (const pin of pins) {
    const target = pin.day_date !== null ? buckets.get(pin.day_date) : undefined;
    (target ?? buckets.get(UNASSIGNED))?.push(pin);
  }
  for (const list of buckets.values()) list.sort(bySortOrder);
  return buckets;
}

export function bucketOf(pin: ProjectPin, days: TripDay[]): BucketKey {
  if (pin.day_date !== null && days.some((d) => d.date === pin.day_date)) return pin.day_date;
  return UNASSIGNED;
}

export interface PinDisplayMeta {
  /** 1-based position within its day; `null` for Saved Places. */
  number: number | null;
  color: string;
  bucket: BucketKey;
  dayIndex: number | null;
}

export function buildPinMeta(buckets: Map<BucketKey, ProjectPin[]>, days: TripDay[]): Map<string, PinDisplayMeta> {
  const meta = new Map<string, PinDisplayMeta>();
  for (const day of days) {
    (buckets.get(day.date) ?? []).forEach((pin, i) => {
      meta.set(pin.id, { number: i + 1, color: day.color, bucket: day.date, dayIndex: day.index });
    });
  }
  for (const pin of buckets.get(UNASSIGNED) ?? []) {
    meta.set(pin.id, { number: null, color: UNASSIGNED_COLOR, bucket: UNASSIGNED, dayIndex: null });
  }
  return meta;
}

export function matchesFilter(bucket: BucketKey, filter: DayFilter): boolean {
  return filter === 'all' || filter === bucket;
}

export function bucketLabel(bucket: BucketKey, days: TripDay[]): string {
  if (bucket === UNASSIGNED) return 'Saved Places';
  const day = days.find((d) => d.date === bucket);
  return day ? `Day ${day.index}` : 'Saved Places';
}

export function sumCost(pins: ProjectPin[]): number {
  return pins.reduce((total, pin) => total + (Number.isFinite(pin.cost) ? pin.cost : 0), 0);
}
