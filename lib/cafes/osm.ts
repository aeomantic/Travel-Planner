import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CAFE_TYPES, isInSingapore, type Cafe, type CafeSource, type CafeType } from '@/lib/cafes/types';
import { areaForPostalCode, slugify } from '@/lib/cafes/classify';
import { typesFromName } from '@/lib/cafes/cdc';
import { buildingAt, parseBuilding, withBuildingAddress, type Building } from '@/lib/cafes/buildings';

/*
 * Server-only reader for OpenStreetMap cafés in Singapore, via the Overpass API: every
 * amenity=cafe, amenity=ice_cream, shop=bakery and shop=coffee, with coordinates and whatever
 * the mappers added (address, opening hours, website, brand, cuisine). The data is © OpenStreetMap
 * contributors under the ODbL, so the panel credits it. Overpass is a shared public server: the
 * API route's 24-hour cache keeps this to about one query a day.
 *
 * Half the cafés are mapped as a bare point with no address, often inside a mall or block whose
 * outline does have one. A second, lighter query fetches the addressed buildings within 15 m of
 * those points, with their outlines, and a café missing its address borrows its building's.
 * It's separate so a slow or failed building query never costs the café list itself.
 */

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

export const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright';

const CAFES_QUERY = `[out:json][timeout:90];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(
  nwr["amenity"="cafe"](area.sg);
  nwr["amenity"="ice_cream"](area.sg);
  nwr["shop"="bakery"](area.sg);
  nwr["shop"="coffee"](area.sg);
);
out center tags;`;

/** Only cafés mapped as points without a postcode, and one statement: "around" is the costly part. */
const BUILDINGS_QUERY = `[out:json][timeout:180];
area["ISO3166-1"="SG"][admin_level=2]->.sg;
(
  node["amenity"="cafe"][!"addr:postcode"](area.sg);
  node["amenity"="ice_cream"][!"addr:postcode"](area.sg);
  node["shop"="bakery"][!"addr:postcode"](area.sg);
  node["shop"="coffee"][!"addr:postcode"](area.sg);
)->.cafes;
way(around.cafes:15)["building"][~"^addr:(postcode|street)$"~"."];
out tags geom;`;

/** An OpenStreetMap café, with the brand kept aside for spotting chains. */
export interface OsmCafe {
  cafe: Cafe;
  /** The brand tag, if mappers set one. */
  brand: string | null;
  /** The brand has a Wikidata entry: a recognised chain. */
  knownBrand: boolean;
}

type Tags = Record<string, string>;

/* ----------------------------------------------------------------- parsing --- */

/** Bubble tea shops are often tagged amenity=cafe in Singapore, but nobody goes there for a café. */
const BUBBLE_TEA =
  /bubble ?tea|boba|\bkoi\b|gong ?cha|liho|chagee|mixue|each a cup|playmade|tiger sugar|partea|sharetea|chi ?cha san chen|heytea|r&b tea|xing fu tang|the alley|yi fang|nayuki|machi machi|milksha|jenjudan|hollin|chicha|\br&b\b|\bitea\b/i;

function isBubbleTea(tags: Tags, name: string): boolean {
  return /bubble_tea/.test(tags.cuisine ?? '') || BUBBLE_TEA.test(name) || BUBBLE_TEA.test(tags.brand ?? '');
}

export function osmTypes(tags: Tags, name: string): CafeType[] {
  const found = new Set<CafeType>(typesFromName(name).filter((t) => t !== 'cafe'));
  const cuisine = (tags.cuisine ?? '').toLowerCase();
  if (tags.shop === 'bakery' || /bakery|cake|pastry|bread|donut|pie\b|croissant|bagel/.test(cuisine)) found.add('bakery');
  if (tags.amenity === 'ice_cream' || /ice_cream|dessert|frozen_yogurt|gelato|waffle|bingsu|acai/.test(cuisine)) {
    found.add('dessert');
  }
  if (tags.shop === 'coffee' || /specialty|roaster/.test(cuisine)) found.add('specialty-coffee');
  if (/breakfast|brunch/.test(cuisine)) found.add('brunch');
  if (/kopitiam|kaya|kopi/.test(cuisine)) found.add('traditional');
  return found.size > 0 ? CAFE_TYPES.filter((t) => found.has(t)) : ['cafe'];
}

const OSM_DAYS: Record<string, string> = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };

function clock(h: string, m: string): string {
  const hour = Number(h) % 24;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${m === '00' ? '' : `:${m}`}${hour < 12 ? 'am' : 'pm'}`;
}

/** OSM opening_hours in the panel's style: "Mo-Fr 08:00-18:00; Sa 09:00-14:00" → "Mon–Fri 8am–6pm, Sat 9am–2pm". */
export function formatOsmHours(raw: string): string {
  const text = raw.trim();
  if (text === '24/7') return 'Open 24 hours';
  return text
    .replace(/\bMo-Su\b/g, 'Daily')
    .replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (day) => OSM_DAYS[day] ?? day)
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) => clock(h, m))
    .replace(/\s*-\s*/g, '–')
    .replace(/\s*;\s*/g, ', ')
    .replace(/\boff\b/gi, 'closed');
}

function osmAddress(tags: Tags): { address: string | null; postalCode: string | null } {
  const postcode = tags['addr:postcode']?.replace(/\D/g, '') ?? '';
  const postalCode = /^\d{6}$/.test(postcode) ? postcode : null;
  // Typed by mappers: "#01-05/06 370 Alexandra Road, Anchorpoint Shopping Centre,, Singapore 159953".
  if (tags['addr:full']) return { address: tags['addr:full'].replace(/\s*,(?:\s*,)+/g, ',').replace(/\s+/g, ' ').trim(), postalCode };

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const unit = tags['addr:unit'] ? `#${tags['addr:unit'].replace(/^#/, '')}` : null;
  // Malls and buildings: "addr:place" or "addr:housename" ("Funan").
  const building = tags['addr:place'] ?? tags['addr:housename'] ?? null;
  const parts = [street || null, unit, building && !street.includes(building) ? building : null].filter(
    (part): part is string => Boolean(part),
  );
  // A unit number on its own ("#01-05") doesn't tell anyone where to go.
  if (!street && !building && !postalCode) return { address: null, postalCode };
  if (postalCode) parts.push(`Singapore ${postalCode}`);
  return { address: parts.join(', '), postalCode };
}

function websiteOf(tags: Tags): string | null {
  const url = tags.website ?? tags['contact:website'] ?? null;
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function elementsOf(json: unknown): unknown[] {
  const elements = (json as { elements?: unknown } | null)?.elements;
  if (!Array.isArray(elements)) throw new Error('Overpass response has no "elements" list');
  return elements as unknown[];
}

/** Building outlines come with geometry; cafés (with `out center`) don't. */
const outlined = (element: unknown): element is Record<string, unknown> =>
  Boolean(element && typeof element === 'object' && ('geometry' in element || 'members' in element));

/** Exported for testing against saved Overpass responses: the cafés, and optionally their buildings. */
export function parseOverpass(json: unknown, buildingsJson?: unknown): OsmCafe[] {
  const elements = elementsOf(json);
  const buildings = [...elements, ...(buildingsJson ? elementsOf(buildingsJson) : [])]
    .filter(outlined)
    .map(parseBuilding)
    .filter((b): b is Building => b !== null);

  const cafes: OsmCafe[] = [];
  for (const element of elements) {
    if (!element || typeof element !== 'object' || outlined(element)) continue;
    const { type, id, lat, lon, center, tags } = element as {
      type?: unknown;
      id?: unknown;
      lat?: unknown;
      lon?: unknown;
      center?: { lat?: unknown; lon?: unknown };
      tags?: Tags;
    };
    if (typeof type !== 'string' || typeof id !== 'number' || !tags) continue;
    const name = (tags['name:en'] ?? tags.name ?? tags.brand ?? '').replace(/\s+/g, ' ').trim();
    const point = { lat: Number(lat ?? center?.lat), lng: Number(lon ?? center?.lon) };
    // Unnamed, outside Singapore, closed, or not a café after all.
    if (!name || !isInSingapore(point.lat, point.lng) || isBubbleTea(tags, name)) continue;
    if (tags['disused:amenity'] || tags['disused:shop'] || tags.vending) continue;

    // No postcode of its own: fill the gaps from the building it's in.
    let addressTags = tags;
    if (!tags['addr:full'] && !/^\d{6}$/.test(tags['addr:postcode'] ?? '')) {
      const building = buildingAt(point, buildings);
      if (building) addressTags = withBuildingAddress(tags, building);
    }
    const { address, postalCode } = osmAddress(addressTags);
    const brand = tags.brand?.trim() || null;
    cafes.push({
      cafe: {
        id: `${slugify(name)}-osm${type[0]}${id}`,
        name,
        area: areaForPostalCode(postalCode),
        address,
        postalCode,
        lat: point.lat,
        lng: point.lng,
        hours: tags.opening_hours ? formatOsmHours(tags.opening_hours) : null,
        priceMin: null,
        priceMax: null,
        priceTier: null,
        types: osmTypes(tags, name),
        charging: null,
        halal: null,
        cdcVouchers: false,
        chain: false,
        website: websiteOf(tags),
        sourceUrl: `https://www.openstreetmap.org/${type}/${id}`,
        sourceTitle: 'OpenStreetMap',
      },
      brand,
      knownBrand: Boolean(tags['brand:wikidata']),
    });
  }
  return cafes;
}

/* ------------------------------------------------------------------- fetch --- */

/** Busy or rate-limited: worth asking again. */
const RETRYABLE = new Set([429, 502, 503, 504]);
/** The main server often answers "at capacity" and then has room a minute later. */
const PATIENT = [
  { endpoint: OVERPASS_ENDPOINTS[0], waitMs: 0 },
  { endpoint: OVERPASS_ENDPOINTS[0], waitMs: 15_000 },
  { endpoint: OVERPASS_ENDPOINTS[0], waitMs: 30_000 },
  { endpoint: OVERPASS_ENDPOINTS[1], waitMs: 0 },
];
/** With an earlier result to fall back on, one try: nobody should wait minutes for the page. */
const QUICK = [{ endpoint: OVERPASS_ENDPOINTS[0], waitMs: 0, timeoutMs: 60_000 }];
/** The building query is slower; it only fills in addresses, so it gets one patient try. */
const BUILDINGS_ATTEMPTS = [{ endpoint: OVERPASS_ENDPOINTS[0], waitMs: 0, timeoutMs: 180_000 }];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Overpass answers 406 to browser-like User-Agents ("Mozilla/5.0 …"), so it gets a plain one. */
const OVERPASS_USER_AGENT = 'WayfarerTripPlanner/0.1 (Singapore cafe list)';

/*
 * Overpass is often at capacity, so the last good result is kept: in memory, and in a snapshot
 * under .next/cache that survives restarts (best effort: a read-only disk just skips it).
 */
const SNAPSHOT = path.join(process.cwd(), '.next', 'cache', 'wayfarer-osm-cafes.json');
let lastGood: { cafes: OsmCafe[]; savedAt: string } | null = null;

async function saveSnapshot(snapshot: { cafes: OsmCafe[]; savedAt: string }) {
  try {
    await mkdir(path.dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('[cafes] couldn’t save the OpenStreetMap snapshot:', error instanceof Error ? error.message : error);
  }
}

async function loadSnapshot(): Promise<{ cafes: OsmCafe[]; savedAt: string } | null> {
  try {
    const json = JSON.parse(await readFile(SNAPSHOT, 'utf8')) as { cafes?: unknown; savedAt?: unknown };
    return Array.isArray(json.cafes) && typeof json.savedAt === 'string'
      ? { cafes: json.cafes as OsmCafe[], savedAt: json.savedAt }
      : null;
  } catch {
    return null;
  }
}

/**
 * Singapore's cafés from OpenStreetMap. `fresh` is false when Overpass couldn't be reached and
 * this is the last good result instead.
 */
export async function fetchOsmCafes(): Promise<{ cafes: OsmCafe[]; fresh: boolean }> {
  lastGood ??= await loadSnapshot();
  try {
    const cafesJson = await queryOverpass(CAFES_QUERY, lastGood ? QUICK : PATIENT);
    let buildingsJson: unknown = null;
    try {
      buildingsJson = await queryOverpass(BUILDINGS_QUERY, BUILDINGS_ATTEMPTS);
    } catch (error) {
      console.warn(`[cafes] building addresses: ${error instanceof Error ? error.message : String(error)}`);
    }
    let cafes = parseOverpass(cafesJson, buildingsJson);
    if (!buildingsJson && lastGood) cafes = withEarlierAddresses(cafes, lastGood.cafes);
    lastGood = { cafes, savedAt: new Date().toISOString() };
    void saveSnapshot(lastGood);
    return { cafes, fresh: true };
  } catch (error) {
    const previous = lastGood;
    if (!previous) throw error;
    console.warn(
      `[cafes] ${error instanceof Error ? error.message : String(error)}; using the OpenStreetMap result from ${previous.savedAt}`,
    );
    return { cafes: previous.cafes, fresh: false };
  }
}

/** Without this run's building query, addresses filled from buildings last time still apply. */
function withEarlierAddresses(cafes: OsmCafe[], earlier: OsmCafe[]): OsmCafe[] {
  const before = new Map(earlier.map(({ cafe }) => [cafe.id, cafe]));
  return cafes.map((entry) => {
    const old = before.get(entry.cafe.id);
    const better = old && ((!entry.cafe.postalCode && old.postalCode) || (!entry.cafe.address && old.address));
    if (!better) return entry;
    return {
      ...entry,
      cafe: { ...entry.cafe, address: old.address, postalCode: old.postalCode, area: old.area ?? entry.cafe.area },
    };
  });
}

async function queryOverpass(query: string, attempts: { endpoint: string; waitMs: number; timeoutMs?: number }[]): Promise<unknown> {
  const failures: string[] = [];
  /** Servers that refused outright: asking again won't help. */
  const refused = new Set<string>();
  for (const { endpoint, waitMs, timeoutMs = 120_000 } of attempts) {
    if (refused.has(endpoint)) continue;
    if (waitMs > 0) await wait(waitMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': OVERPASS_USER_AGENT,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: query }),
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        failures.push(`${new URL(endpoint).host}: HTTP ${response.status}`);
        if (!RETRYABLE.has(response.status)) refused.add(endpoint);
        continue;
      }
      return (await response.json()) as unknown;
    } catch (error) {
      failures.push(`${new URL(endpoint).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`OpenStreetMap (Overpass) unavailable: ${failures.join('; ')}`);
}

export function osmSource(count: number): CafeSource {
  return { title: 'OpenStreetMap cafés, bakeries and ice cream shops (© OpenStreetMap contributors, ODbL)', url: OSM_COPYRIGHT, count };
}
