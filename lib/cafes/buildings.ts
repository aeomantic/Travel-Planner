import type { LatLng } from '@/lib/cafes/geo';

/*
 * Building outlines from OpenStreetMap that carry an address. Many cafés are mapped as a bare
 * point inside a mall or block, with the address only on the building around them; this finds
 * that building so the café can borrow its address.
 */

type Tags = Record<string, string>;

export interface Building {
  tags: Tags;
  /** Closed outer rings. */
  rings: LatLng[][];
  /** Every outer edge, closed or not (multipolygon outlines often come in pieces). */
  edges: [LatLng, LatLng][];
  box: { south: number; west: number; north: number; east: number };
}

/** A café pin dropped on the pavement outside still belongs to the building this close. */
const OUTSIDE_WALL_M = 10;

type RawPoint = { lat?: unknown; lon?: unknown };

function toPoints(geometry: unknown): LatLng[] {
  if (!Array.isArray(geometry)) return [];
  return (geometry as RawPoint[])
    .map((p) => ({ lat: Number(p?.lat), lng: Number(p?.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

const closed = (line: LatLng[]) =>
  line.length >= 4 && line[0]!.lat === line[line.length - 1]!.lat && line[0]!.lng === line[line.length - 1]!.lng;

/** An Overpass element from `out tags geom` that has an address, or null. */
export function parseBuilding(element: Record<string, unknown>): Building | null {
  const tags = element.tags as Tags | undefined;
  if (!tags || !(tags['addr:postcode'] || tags['addr:street'])) return null;

  let lines: LatLng[][] = [];
  if (element.type === 'way') lines = [toPoints(element.geometry)];
  else if (element.type === 'relation' && Array.isArray(element.members)) {
    lines = (element.members as { role?: unknown; geometry?: unknown }[])
      // Multipolygons say "outer"; building relations say "outline".
      .filter((m) => m.role === 'outer' || m.role === 'outline' || m.role === '')
      .map((m) => toPoints(m.geometry));
  }
  lines = lines.filter((line) => line.length >= 2);
  if (lines.length === 0) return null;

  const all = lines.flat();
  return {
    tags,
    rings: lines.filter(closed),
    edges: lines.flatMap((line) => line.slice(1).map((p, i): [LatLng, LatLng] => [line[i]!, p])),
    box: {
      south: Math.min(...all.map((p) => p.lat)),
      north: Math.max(...all.map((p) => p.lat)),
      west: Math.min(...all.map((p) => p.lng)),
      east: Math.max(...all.map((p) => p.lng)),
    },
  };
}

function inRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) {
      inside = !inside;
    }
  }
  return inside;
}

/** Metres from `p` to the segment a–b, on a flat projection around `p`. */
function toSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos((p.lat * Math.PI) / 180);
  const ax = (a.lng - p.lng) * k;
  const ay = a.lat - p.lat;
  const bx = (b.lng - p.lng) * k;
  const by = b.lat - p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
  return Math.hypot(ax + t * dx, ay + t * dy) * 111_320;
}

const area = (b: Building) => (b.box.north - b.box.south) * (b.box.east - b.box.west);

/** Margin around a point for the bounding-box prefilter: a bit more than OUTSIDE_WALL_M. */
const MARGIN_DEG = 0.0002;

/**
 * The building a point is in (the smallest, when a tower sits inside a podium outline), else
 * the nearest one whose wall is within 10 m.
 */
export function buildingAt(p: LatLng, buildings: Building[]): Building | null {
  const nearby = buildings.filter(
    (b) =>
      p.lat >= b.box.south - MARGIN_DEG &&
      p.lat <= b.box.north + MARGIN_DEG &&
      p.lng >= b.box.west - MARGIN_DEG &&
      p.lng <= b.box.east + MARGIN_DEG,
  );
  const containing = nearby.filter((b) => b.rings.some((ring) => inRing(p, ring))).sort((a, b) => area(a) - area(b));
  if (containing[0]) return containing[0];

  let best: Building | null = null;
  let bestM = OUTSIDE_WALL_M;
  for (const b of nearby) {
    for (const [a, c] of b.edges) {
      const m = toSegment(p, a, c);
      if (m <= bestM) {
        bestM = m;
        best = b;
      }
    }
  }
  return best;
}

const ADDRESS_KEYS = ['addr:housenumber', 'addr:street', 'addr:postcode', 'addr:housename', 'addr:place'] as const;

/**
 * The café's own address tags, with gaps filled from its building: house number, street,
 * postcode, and the building's name ("Funan"). A café whose street differs from the building's
 * keeps its own tags: the two don't describe the same place.
 */
export function withBuildingAddress(cafeTags: Tags, building: Building): Tags {
  const own = cafeTags['addr:street'];
  const theirs = building.tags['addr:street'];
  if (own && theirs && own.toLowerCase() !== theirs.toLowerCase()) return cafeTags;

  const merged: Tags = { ...cafeTags };
  for (const key of ADDRESS_KEYS) {
    const value = building.tags[key];
    if (value && !merged[key]) merged[key] = value;
  }
  const name = building.tags.name;
  if (name && !merged['addr:housename'] && !merged['addr:place']) merged['addr:housename'] = name;
  return merged;
}
