/** Mirrors the `category` check constraint on `public.project_pins`. */
export type PinCategory = 'sightseeing' | 'food' | 'hotel' | 'transit' | 'other';

export const PIN_CATEGORIES: readonly PinCategory[] = [
  'sightseeing',
  'food',
  'hotel',
  'transit',
  'other',
] as const;

/** ISO calendar date, `YYYY-MM-DD` (Postgres `date`). */
export type ISODate = string;

/** Row in `public.projects`. */
export interface Project {
  id: string;
  user_id: string | null;
  title: string;
  destination_name: string;
  center_lat: number;
  center_lng: number;
  start_date: ISODate;
  end_date: ISODate;
  created_at: string;
}

/** Row in `public.project_pins`. `day_date === null` means the pin lives in Saved Places. */
export interface ProjectPin {
  id: string;
  project_id: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  category: PinCategory;
  day_date: ISODate | null;
  sort_order: number;
  notes: string | null;
  cost: number;
  created_at: string;
}

export type NewProjectInput = Pick<
  Project,
  'title' | 'destination_name' | 'center_lat' | 'center_lng' | 'start_date' | 'end_date'
>;

export type ProjectUpdate = Partial<NewProjectInput>;

export type NewPinInput = Omit<ProjectPin, 'created_at' | 'id'>;

export type PinUpdate = Partial<Omit<ProjectPin, 'id' | 'project_id' | 'created_at'>>;

/** Persisted position of a pin after a drag/reorder. */
export interface PinPlacement {
  id: string;
  day_date: ISODate | null;
  sort_order: number;
}

/** Bucket key used across the UI: an ISO date, or the unassigned Saved Places bucket. */
export const UNASSIGNED = 'unassigned' as const;
export type BucketKey = ISODate | typeof UNASSIGNED;

/** Map day filter: everything, one day, or the Saved Places bucket. */
export type DayFilter = 'all' | BucketKey;

export interface TripDay {
  date: ISODate;
  /** 1-based day number within the trip. */
  index: number;
  label: string;
  color: string;
}
