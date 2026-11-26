import { searchPlaces } from '@/lib/geocode';
import { isInSingapore, type Cafe } from '@/lib/cafes/types';
import { SCRAPER_USER_AGENT, type ScrapedCafe } from '@/lib/cafes/eatbook';

/*
 * Server-side geocoding for scraped cafés. A Singapore postal code is one building, so the
 * first stop is a postcode index built from a source that already has coordinates (the CDC
 * Vouchers directory). After that: OneMap (Singapore Land Authority) by postal code or street,
 * then Photon (lib/geocode) by name and address.
 */

const ONEMAP_SEARCH = 'https://www.onemap.gov.sg/api/common/elastic/search';
const SINGAPORE = { lat: 1.3521, lng: 103.8198 };

type LatLng = { lat: number; lng: number };
type Geocoder = 'onemap' | 'photon';

/** Postal code → building coordinates. */
export type PostcodeIndex = ReadonlyMap<string, LatLng>;

/** Survives refreshes: addresses rarely move, so a re-scrape only geocodes new cafés. */
const memo = new Map<string, LatLng | null>();

/** The geocoder refuses every request (OneMap's search now wants a token, for one), so stop asking. */
class Unavailable extends Error {}

/** A geocoder that errors this many times in one refresh is skipped for the rest of it. */
const MAX_ERRORS = 3;

async function oneMap(searchVal: string): Promise<LatLng | null> {
  const url = new URL(ONEMAP_SEARCH);
  url.searchParams.set('searchVal', searchVal);
  url.searchParams.set('returnGeom', 'Y');
  url.searchParams.set('getAddrDetails', 'Y');
  url.searchParams.set('pageNum', '1');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': SCRAPER_USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 || response.status === 403) throw new Unavailable(`HTTP ${response.status}`);
  if (!response.ok) return null;
  const json: unknown = await response.json();
  const results = (json as { results?: unknown }).results;
  const first: unknown = Array.isArray(results) ? results[0] : null;
  if (!first || typeof first !== 'object') return null;
  const { LATITUDE, LONGITUDE } = first as { LATITUDE?: unknown; LONGITUDE?: unknown };
  const lat = Number(LATITUDE);
  const lng = Number(LONGITUDE);
  return Number.isFinite(lat) && Number.isFinite(lng) && isInSingapore(lat, lng) ? { lat, lng } : null;
}

async function photon(query: string): Promise<LatLng | null> {
  const [hit] = await searchPlaces(query, { near: SINGAPORE, limit: 1, signal: AbortSignal.timeout(8_000) });
  return hit && isInSingapore(hit.lat, hit.lng) ? { lat: hit.lat, lng: hit.lng } : null;
}

/** One refresh's view of which geocoders are failing. */
interface Run {
  postcodes: PostcodeIndex | undefined;
  errors: Record<Geocoder, number>;
  down: Set<Geocoder>;
}

function noteError(run: Run, service: Geocoder, error: unknown) {
  run.errors[service] += 1;
  if (run.down.has(service) || (!(error instanceof Unavailable) && run.errors[service] < MAX_ERRORS)) return;
  run.down.add(service);
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[cafes] ${service} isn't answering (${message}); skipping it for the rest of this refresh`);
}

async function locate(cafe: ScrapedCafe, run: Run): Promise<LatLng | null> {
  const building = cafe.postalCode ? run.postcodes?.get(cafe.postalCode) : undefined;
  if (building) return building;

  const key = cafe.postalCode ?? (cafe.address ?? cafe.name).toLowerCase();
  if (memo.has(key)) return memo.get(key) ?? null;

  const street = cafe.address?.split(',')[0]?.trim() ?? '';
  const attempts: [Geocoder, () => Promise<LatLng | null>][] = [];
  if (cafe.postalCode) attempts.push(['onemap', () => oneMap(cafe.postalCode!)]);
  if (street) attempts.push(['onemap', () => oneMap(street)]);
  attempts.push(['photon', () => photon(`${cafe.name}, ${cafe.address ?? 'Singapore'}`)]);

  let found: LatLng | null = null;
  let incomplete = false;
  for (const [service, attempt] of attempts) {
    if (run.down.has(service)) {
      incomplete = true;
      continue;
    }
    try {
      found = await attempt();
    } catch (error) {
      incomplete = true;
      noteError(run, service, error);
      found = null;
    }
    if (found) break;
  }
  // A miss because a geocoder was down isn't remembered, so the next refresh tries again.
  if (found || !incomplete) memo.set(key, found);
  return found;
}

/** Geocodes with a small worker pool so the public geocoders aren't hammered. */
export async function geocodeCafes(
  cafes: ScrapedCafe[],
  { postcodes, concurrency = 4 }: { postcodes?: PostcodeIndex; concurrency?: number } = {},
): Promise<Cafe[]> {
  const run: Run = { postcodes, errors: { onemap: 0, photon: 0 }, down: new Set() };
  const located: Cafe[] = new Array(cafes.length);
  let next = 0;
  const worker = async () => {
    while (next < cafes.length) {
      const index = next++;
      const cafe = cafes[index]!;
      const point = await locate(cafe, run);
      located[index] = { ...cafe, lat: point?.lat ?? null, lng: point?.lng ?? null };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cafes.length) }, worker));
  return located;
}
