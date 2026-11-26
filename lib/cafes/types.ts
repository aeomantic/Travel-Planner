/**
 * What the Cafés panel shows: cafés from OpenStreetMap, facts scraped from Singapore food guides
 * (never their prose), and cafés from the official CDC Vouchers merchant directory.
 */

export type CafeType = 'specialty-coffee' | 'brunch' | 'bakery' | 'dessert' | 'traditional' | 'work-friendly' | 'cafe';

export const CAFE_TYPES: readonly CafeType[] = [
  'specialty-coffee',
  'brunch',
  'bakery',
  'dessert',
  'traditional',
  'work-friendly',
  'cafe',
] as const;

export const CAFE_TYPE_LABELS: Record<CafeType, string> = {
  'specialty-coffee': 'Specialty coffee',
  brunch: 'Brunch',
  bakery: 'Bakery',
  dessert: 'Dessert',
  traditional: 'Kopi & toast',
  'work-friendly': 'Work-friendly',
  cafe: 'Café',
};

/** From the typical dish price: `$` ≤ S$10, `$$` ≤ S$25, `$$$` above. */
export type PriceTier = '$' | '$$' | '$$$';
export const PRICE_TIERS: readonly PriceTier[] = ['$', '$$', '$$$'] as const;

export type HalalStatus = 'certified' | 'no-pork-lard' | 'not-certified';

export interface Cafe {
  /** Slug of the name (plus the postcode or OSM id for branches); stable across scrapes. */
  id: string;
  name: string;
  /** Neighbourhood from the guide's section heading, else from the postal district. */
  area: string | null;
  /** Null for OpenStreetMap cafés mapped without an address. */
  address: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  /** Compact opening hours, e.g. "Tue–Sun 8am–7pm". */
  hours: string | null;
  /** Cheapest and dearest dish prices the guide quotes (S$). */
  priceMin: number | null;
  priceMax: number | null;
  priceTier: PriceTier | null;
  types: CafeType[];
  /** Charging ports / power sockets: true or false when the guide says so, null when it doesn't. */
  charging: boolean | null;
  halal: HalalStatus | null;
  /**
   * Takes CDC Vouchers: listed in the official CDC merchant directory at this address, or in a
   * guide to cafés that accept them. false only means we found no listing.
   */
  cdcVouchers: boolean;
  /** One of several outlets: an OpenStreetMap brand, or a name with four or more outlets here. */
  chain: boolean;
  website: string | null;
  /** The guide entry, OpenStreetMap feature or directory search this came from. */
  sourceUrl: string;
  sourceTitle: string;
}

export interface CafeSource {
  title: string;
  url: string;
  count: number;
}

export interface CafesResponse {
  cafes: Cafe[];
  scrapedAt: string;
  sources: CafeSource[];
  /** A refresh failed and this is the last good scrape. */
  stale?: boolean;
}

/** Singapore, roughly: trips centred here get the Cafés tab. */
export function isInSingapore(lat: number, lng: number): boolean {
  return lat >= 1.15 && lat <= 1.48 && lng >= 103.6 && lng <= 104.1;
}

export function formatPriceRange(cafe: Pick<Cafe, 'priceMin' | 'priceMax'>): string | null {
  const { priceMin: min, priceMax: max } = cafe;
  if (min === null || max === null) return null;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  return min === max ? `S$${fmt(min)}` : `S$${fmt(min)}–${fmt(max)}`;
}

export const CHARGING_LABEL: Record<'yes' | 'no' | 'unknown', string> = {
  yes: 'Yes',
  no: 'No',
  unknown: 'Not mentioned',
};

export function chargingKey(value: boolean | null): keyof typeof CHARGING_LABEL {
  return value === true ? 'yes' : value === false ? 'no' : 'unknown';
}

/** Short name for the link back to where a café was found. */
export function sourceLabel(sourceUrl: string): string {
  if (sourceUrl.includes('gowhere.gov.sg')) return 'CDC GoWhere';
  if (sourceUrl.includes('openstreetmap.org')) return 'OSM';
  return 'Eatbook';
}

export const HALAL_LABEL: Record<HalalStatus, string> = {
  certified: 'Halal-certified',
  'no-pork-lard': 'No pork or lard',
  'not-certified': 'Not halal-certified',
};
