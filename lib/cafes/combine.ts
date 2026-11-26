import type { Cafe } from '@/lib/cafes/types';
import { areaForPostalCode, sameBusiness, slugify } from '@/lib/cafes/classify';
import { applyCdcDirectory, postcodeIndex, type CdcDirectory } from '@/lib/cafes/cdc';
import type { ScrapedCafe } from '@/lib/cafes/eatbook';
import { geocodeCafes } from '@/lib/cafes/geocode';
import { NearbyIndex, distance, type LatLng } from '@/lib/cafes/geo';
import type { OsmCafe } from '@/lib/cafes/osm';

/*
 * One list from three sources, each doing what it's good at:
 *   - OpenStreetMap: the base list, every mapped café with exact coordinates;
 *   - Eatbook guides: the curated picks, with prices, hours, charging ports and types;
 *   - the CDC Vouchers directory: which cafés take CDC Vouchers, plus heartland cafés OSM lacks.
 * A guide café found in OSM takes OSM's coordinates and replaces the OSM entry. A directory
 * listing at the same place marks a café as taking CDC Vouchers; the rest are added.
 */

/** How far a guide café's postcode building can be from its OSM entry (malls are big). */
const GUIDE_TO_OSM_M = 200;
/** Mapped twice: the same name this close together. */
const DUPLICATE_M = 40;
/** A name with this many outlets in the list is a chain. */
const CHAIN_OUTLETS = 4;
/** An OSM café without a postcode takes its area (a postal district) from the nearest known postcode this close. */
const AREA_FROM_M = 1_000;

export interface Combined {
  cafes: Cafe[];
  /** OSM cafés that made it in on their own (not merged into a guide café). */
  fromOsm: number;
  fromDirectory: number;
}

type Located = Cafe & LatLng;
const located = (cafe: Cafe): cafe is Located => cafe.lat !== null && cafe.lng !== null;

function findInOsm(guide: ScrapedCafe, anchor: LatLng | undefined, pool: Set<OsmCafe>, osm: OsmCafe[]): OsmCafe | null {
  const candidates = osm.filter((o) => pool.has(o) && sameBusiness(guide.name, o.cafe.name));
  if (candidates.length === 0) return null;
  const samePostcode = guide.postalCode ? candidates.find((o) => o.cafe.postalCode === guide.postalCode) : undefined;
  if (samePostcode) return samePostcode;
  if (anchor) {
    const near = candidates
      .map((o) => ({ o, d: distance(anchor, o.cafe as Located) }))
      .filter(({ d }) => d <= GUIDE_TO_OSM_M)
      .sort((a, b) => a.d - b.d)[0];
    return near?.o ?? null;
  }
  // Nowhere to anchor the guide's address: take OSM's only outlet of that name, unless its
  // postcode says it's a different one.
  const [only] = candidates;
  return candidates.length === 1 && only && !(guide.postalCode && only.cafe.postalCode) ? only : null;
}

/** Same name within 40 m: OSM sometimes has a café as both a point and a building outline. */
function withoutDuplicates(cafes: Located[]): Located[] {
  const order = new Map(cafes.map((cafe, i) => [cafe, i]));
  const index = new NearbyIndex(cafes);
  const dropped = new Set<Located>();
  for (const cafe of cafes) {
    const earlier = index
      .near(cafe, DUPLICATE_M)
      .some((other) => order.get(other)! < order.get(cafe)! && !dropped.has(other) && sameBusiness(other.name, cafe.name));
    if (earlier) dropped.add(cafe);
  }
  return cafes.filter((cafe) => !dropped.has(cafe));
}

/** "Starbucks Coffee - Raffles Place" and "Starbucks @ Funan" both count as "starbucks-coffee"/"starbucks". */
function chainKey(name: string): string {
  return slugify(name.replace(/\s+(?:[-–@|(]|at\s).*$/i, ''));
}

export async function combineCafes({
  guides,
  osm,
  directory,
}: {
  guides: ScrapedCafe[];
  osm: OsmCafe[];
  directory: CdcDirectory | null;
}): Promise<Combined> {
  // A Singapore postcode is one building: the directory and OSM both say where many of them are.
  const postcodes = directory ? postcodeIndex(directory) : new Map<string, LatLng>();
  for (const { cafe } of osm) {
    if (cafe.postalCode && !postcodes.has(cafe.postalCode)) postcodes.set(cafe.postalCode, cafe as Located);
  }

  // 1. Guide cafés: OSM's coordinates when it has the café, else the postcode's building, else geocode.
  const pool = new Set(osm);
  const guideCafes: Cafe[] = guides.map((guide) => {
    const anchor = guide.postalCode ? postcodes.get(guide.postalCode) : undefined;
    const match = findInOsm(guide, anchor, pool, osm);
    if (match) {
      pool.delete(match);
      const { cafe } = match;
      return {
        ...guide,
        lat: cafe.lat,
        lng: cafe.lng,
        area: guide.area ?? cafe.area,
        hours: guide.hours ?? cafe.hours,
        website: guide.website ?? cafe.website,
      };
    }
    return { ...guide, lat: anchor?.lat ?? null, lng: anchor?.lng ?? null };
  });
  const unplaced = guideCafes.filter((cafe) => !located(cafe));
  if (unplaced.length > 0) {
    const geocoded = new Map((await geocodeCafes(unplaced, { postcodes })).map((cafe) => [cafe.id, cafe]));
    guideCafes.forEach((cafe, i) => {
      if (!located(cafe)) guideCafes[i] = geocoded.get(cafe.id) ?? cafe;
    });
  }

  // 2. OSM's other cafés, with an area from the nearest known postcode when OSM has none.
  const brands = new Map<string, OsmCafe>();
  const knownPostcodes = new NearbyIndex(
    [...postcodes].map(([postalCode, point]) => ({ postalCode, lat: point.lat, lng: point.lng })),
    0.01,
  );
  const osmCafes = withoutDuplicates([...pool].map(({ cafe }) => cafe as Located)).map((cafe) => {
    if (cafe.area) return cafe;
    const nearest = knownPostcodes.near(cafe, AREA_FROM_M)[0];
    return nearest ? { ...cafe, area: areaForPostalCode(nearest.postalCode) } : cafe;
  });
  for (const entry of pool) brands.set(entry.cafe.id, entry);

  // 3. CDC Vouchers: mark what the directory lists, add the directory's other cafés.
  let cafes = [...guideCafes, ...osmCafes];
  let added: Cafe[] = [];
  if (directory) ({ cafes, added } = applyCdcDirectory(cafes, directory));

  // Guide picks first, in guide order; then everything else by name.
  const rest = [...cafes.slice(guideCafes.length), ...added].sort((a, b) => a.name.localeCompare(b.name));
  const all = [...cafes.slice(0, guideCafes.length), ...rest];

  // 4. Chains: a recognised brand, or a name with four or more outlets.
  const keyOf = (cafe: Cafe) => chainKey(brands.get(cafe.id)?.brand ?? cafe.name);
  const outlets = new Map<string, number>();
  for (const cafe of all) outlets.set(keyOf(cafe), (outlets.get(keyOf(cafe)) ?? 0) + 1);
  const withChains = all.map((cafe) => {
    const chain = brands.get(cafe.id)?.knownBrand === true || (outlets.get(keyOf(cafe)) ?? 0) >= CHAIN_OUTLETS;
    return chain === cafe.chain ? cafe : { ...cafe, chain };
  });

  return { cafes: withChains, fromOsm: osmCafes.length, fromDirectory: added.length };
}
