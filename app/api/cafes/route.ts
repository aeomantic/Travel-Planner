import { NextResponse } from 'next/server';
import type { CafeSource, CafesResponse } from '@/lib/cafes/types';
import { scrapeEatbook } from '@/lib/cafes/eatbook';
import { cdcSource, fetchCdcDirectory } from '@/lib/cafes/cdc';
import { fetchOsmCafes, osmSource } from '@/lib/cafes/osm';
import { combineCafes } from '@/lib/cafes/combine';

// cheerio and the scrape need Node, and the response depends on when it was scraped.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MS = 24 * 60 * 60 * 1000;
/** A list missing a source is kept for less time, so it fills in sooner. */
const PARTIAL_TTL_MS = 30 * 60 * 1000;
/** Built from the saved OpenStreetMap result because Overpass was busy: complete, just older. */
const SNAPSHOT_TTL_MS = 3 * 60 * 60 * 1000;
/** `?refresh=1` can't re-scrape more often than this, so the endpoint can't be used to hammer the sources. */
const MIN_REFRESH_MS = 10 * 60 * 1000;

let cached: { data: CafesResponse; at: number; ttl: number } | null = null;
let inflight: Promise<{ data: CafesResponse; ttl: number }> | null = null;

const reason = (result: PromiseRejectedResult) =>
  result.reason instanceof Error ? result.reason.message : String(result.reason);

/** Each source can fail on its own; the cafés come from whichever answered. */
async function scrape(): Promise<{ data: CafesResponse; ttl: number }> {
  const [guides, osm, directory] = await Promise.allSettled([scrapeEatbook(), fetchOsmCafes(), fetchCdcDirectory()]);
  const failures = [guides, osm, directory].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const failure of failures) console.warn('[cafes] source unavailable:', reason(failure));
  if (guides.status === 'fulfilled' && guides.value.cafes.length === 0) {
    console.warn('[cafes] 0 cafés on Eatbook: the page layout may have changed');
  }
  if (failures.length === 3) throw new Error(failures.map(reason).join('; '));

  const { cafes, fromOsm, fromDirectory } = await combineCafes({
    guides: guides.status === 'fulfilled' ? guides.value.cafes : [],
    osm: osm.status === 'fulfilled' ? osm.value.cafes : [],
    directory: directory.status === 'fulfilled' ? directory.value : null,
  });
  if (cafes.length === 0) throw new Error('Found 0 cafés in every source. A page or data format may have changed.');

  const sources: CafeSource[] = [
    ...(guides.status === 'fulfilled' ? guides.value.sources : []),
    ...(osm.status === 'fulfilled' ? [osmSource(fromOsm)] : []),
    ...(directory.status === 'fulfilled' ? [cdcSource(directory.value, fromDirectory)] : []),
  ];
  const ttl = failures.length > 0 ? PARTIAL_TTL_MS : osm.status === 'fulfilled' && !osm.value.fresh ? SNAPSHOT_TTL_MS : TTL_MS;
  return { data: { cafes, scrapedAt: new Date().toISOString(), sources }, ttl };
}

function respond(data: CafesResponse, cache: 'HIT' | 'MISS' | 'STALE') {
  return NextResponse.json(data, {
    headers: { 'X-Cafes-Cache': cache, 'Cache-Control': 'public, max-age=300' },
  });
}

/**
 * GET /api/cafes: Singapore cafés from OpenStreetMap, Eatbook guides and the official CDC Vouchers
 * merchant directory, merged into one list and cached for 24 hours (3 hours if Overpass was busy
 * and the saved OpenStreetMap result stood in, 30 minutes if a source was missing). A failed re-scrape serves the last good list (`stale: true`) instead of an error.
 */
export async function GET(request: Request) {
  const age = cached ? Date.now() - cached.at : Infinity;
  const wantsRefresh = new URL(request.url).searchParams.get('refresh') === '1' && age > MIN_REFRESH_MS;
  if (cached && age < cached.ttl && !wantsRefresh) return respond(cached.data, 'HIT');

  try {
    inflight ??= scrape().finally(() => {
      inflight = null;
    });
    const { data, ttl } = await inflight;
    cached = { data, at: Date.now(), ttl };
    return respond(data, 'MISS');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[cafes]', message);
    if (cached) return respond({ ...cached.data, stale: true }, 'STALE');
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
