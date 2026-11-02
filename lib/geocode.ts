import type { PinCategory } from '@/types/trip';

/**
 * Keyless geocoding via Photon (OpenStreetMap data, built for search-as-you-type).
 * https://photon.komoot.io — fair-use public instance; swap PHOTON_URL for a self-hosted one in production.
 */
const PHOTON_URL = 'https://photon.komoot.io';

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: PinCategory;
  /** e.g. `city`, `restaurant`, `museum` — shown as a hint in results. */
  kind: string;
}

interface PhotonProperties {
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
  name?: string;
  housenumber?: string;
  street?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface PhotonFeature {
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: PhotonProperties;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPhotonFeature(value: unknown): value is PhotonFeature {
  if (!isRecord(value) || !isRecord(value.geometry) || !isRecord(value.properties)) return false;
  const coords = value.geometry.coordinates;
  return Array.isArray(coords) && typeof coords[0] === 'number' && typeof coords[1] === 'number';
}

function parseFeatures(json: unknown): PhotonFeature[] {
  if (!isRecord(json) || !Array.isArray(json.features)) return [];
  return json.features.filter(isPhotonFeature);
}

export function inferCategory(osmKey = '', osmValue = ''): PinCategory {
  if (osmKey === 'amenity' && ['restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court', 'ice_cream', 'biergarten'].includes(osmValue)) {
    return 'food';
  }
  if (osmKey === 'shop' && ['bakery', 'confectionery', 'deli', 'pastry', 'wine', 'alcohol'].includes(osmValue)) return 'food';
  if (osmKey === 'tourism' && ['hotel', 'hostel', 'guest_house', 'motel', 'apartment', 'chalet', 'camp_site'].includes(osmValue)) {
    return 'hotel';
  }
  if (['railway', 'public_transport', 'aeroway', 'highway'].includes(osmKey)) return 'transit';
  if (osmKey === 'amenity' && ['bus_station', 'ferry_terminal', 'taxi', 'car_rental'].includes(osmValue)) return 'transit';
  if (['tourism', 'historic', 'leisure', 'natural', 'man_made'].includes(osmKey)) return 'sightseeing';
  if (osmKey === 'amenity' && ['place_of_worship', 'theatre', 'arts_centre'].includes(osmValue)) return 'sightseeing';
  return 'other';
}

function toPlace(feature: PhotonFeature): PlaceResult {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' ');
  const locality = p.district ?? p.locality;
  const name = p.name ?? (street || p.city || 'Dropped pin');
  const address = [street !== name ? street : null, locality, p.city !== name ? p.city : null, p.country]
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return {
    id: `${p.osm_type ?? 'x'}${p.osm_id ?? `${lat},${lng}`}`,
    name,
    address,
    lat,
    lng,
    category: inferCategory(p.osm_key, p.osm_value),
    kind: (p.osm_value ?? p.type ?? '').replace(/_/g, ' '),
  };
}

function dedupe(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  return places.filter((place) => (seen.has(place.id) ? false : (seen.add(place.id), true)));
}

async function photon(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<PhotonFeature[]> {
  const url = new URL(path, PHOTON_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Geocoder responded ${response.status}`);
  return parseFeatures(await response.json());
}

export async function searchPlaces(
  query: string,
  options: { near?: { lat: number; lng: number }; citiesOnly?: boolean; limit?: number; signal?: AbortSignal } = {},
): Promise<PlaceResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const params: Record<string, string> = { q, limit: String(options.limit ?? 6), lang: 'en' };
  if (options.near) {
    params.lat = options.near.lat.toFixed(5);
    params.lon = options.near.lng.toFixed(5);
  }
  if (options.citiesOnly) params.osm_tag = 'place';
  const features = await photon('/api/', params, options.signal);
  return dedupe(features.map(toPlace));
}

export async function reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<PlaceResult | null> {
  const features = await photon('/reverse', { lat: lat.toFixed(6), lon: lng.toFixed(6), lang: 'en', limit: '1' }, signal);
  const first = features[0];
  return first ? { ...toPlace(first), lat, lng } : null;
}
