export type LatLng = { lat: number; lng: number };

/** Metres, near enough at Singapore's latitude. */
export function distance(a: LatLng, b: LatLng): number {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/**
 * Points bucketed in a coarse grid, so "what's within 100 m" doesn't scan every point. A search
 * radius up to the cell size (about 220 m by default) only needs the 3×3 cells around a point.
 */
export class NearbyIndex<T extends LatLng> {
  private readonly cells = new Map<string, T[]>();
  private readonly maxRadiusM: number;

  constructor(
    points: Iterable<T>,
    private readonly cellDeg = 0.002,
  ) {
    this.maxRadiusM = cellDeg * 111_320;
    for (const point of points) {
      const key = `${this.cellOf(point.lat)}:${this.cellOf(point.lng)}`;
      const cell = this.cells.get(key);
      if (cell) cell.push(point);
      else this.cells.set(key, [point]);
    }
  }

  private cellOf(value: number): number {
    return Math.floor(value / this.cellDeg);
  }

  /** Points within `radiusM` (at most the cell size) of `here`, nearest first. */
  near(here: LatLng, radiusM: number): T[] {
    if (radiusM > this.maxRadiusM) throw new Error(`NearbyIndex radius is limited to ${Math.floor(this.maxRadiusM)} m`);
    const row = this.cellOf(here.lat);
    const col = this.cellOf(here.lng);
    const found: [number, T][] = [];
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        for (const point of this.cells.get(`${r}:${c}`) ?? []) {
          const d = distance(here, point);
          if (d <= radiusM) found.push([d, point]);
        }
      }
    }
    return found.sort((a, b) => a[0] - b[0]).map(([, point]) => point);
  }
}
