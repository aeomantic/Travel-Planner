'use client';

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import {
  Check,
  CircleAlert,
  Clock,
  Coffee,
  Download,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Store,
  Ticket,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import type { Project, ProjectPin } from '@/types/trip';
import {
  CAFE_TYPE_LABELS,
  CAFE_TYPES,
  HALAL_LABEL,
  PRICE_TIERS,
  formatPriceRange,
  sourceLabel,
  type Cafe,
  type CafeType,
  type CafesResponse,
  type PriceTier,
} from '@/lib/cafes/types';
import { cafesToCsv, downloadCsv } from '@/lib/cafes/csv';
import { slugify } from '@/lib/cafes/classify';
import { selectCanEdit, useTripStore } from '@/store/useTripStore';
import { cn } from '@/lib/utils';

/** Kept across tab switches and trips; the API caches for a day anyway. */
let loaded: CafesResponse | null = null;

const FILTER_TYPES = CAFE_TYPES.filter((t) => t !== 'cafe');
/** Cards rendered at a time: the CDC directory alone adds several hundred cafés. */
const PAGE = 50;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function cafeNotes(cafe: Cafe): string {
  return [
    cafe.types.map((t) => CAFE_TYPE_LABELS[t]).join(', '),
    formatPriceRange(cafe),
    cafe.charging === true ? 'Charging ports' : null,
    cafe.cdcVouchers ? 'Takes CDC vouchers' : null,
    cafe.hours,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Singapore Café Hop" → "singapore-cafe-hop". */
function fileSlug(title: string): string {
  return slugify(title) || 'trip';
}

/**
 * Singapore cafés from OpenStreetMap, Eatbook guides and the CDC Vouchers directory (see
 * app/api/cafes): filter by type, price, charging ports, CDC vouchers and chains, add any to
 * Saved Places, or export the filtered list as CSV.
 */
export function CafesPanel({ project, pins }: { project: Project; pins: ProjectPin[] }) {
  const canEdit = useTripStore(selectCanEdit);
  const addPin = useTripStore((s) => s.addPin);
  const selectPin = useTripStore((s) => s.selectPin);
  const setCafeMarkers = useTripStore((s) => s.setCafeMarkers);
  const focusCafe = useTripStore((s) => s.focusCafe);
  const focusedCafeId = useTripStore((s) => s.focusedCafeId);

  const [data, setData] = useState<CafesResponse | null>(loaded);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(loaded ? 'ready' : 'loading');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState<ReadonlySet<CafeType>>(() => new Set());
  const [tiers, setTiers] = useState<ReadonlySet<PriceTier>>(() => new Set());
  const [chargingOnly, setChargingOnly] = useState(false);
  const [cdcOnly, setCdcOnly] = useState(false);
  const [hideChains, setHideChains] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const response = await fetch('/api/cafes');
      const json: unknown = await response.json();
      if (!response.ok || !json || typeof json !== 'object' || !('cafes' in json)) {
        const message = json && typeof json === 'object' && 'error' in json ? String(json.error) : `HTTP ${response.status}`;
        throw new Error(message);
      }
      loaded = json as CafesResponse;
      setData(loaded);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!loaded) void load();
  }, [load]);

  const cafes = useMemo(() => data?.cafes ?? [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cafes.filter(
      (cafe) =>
        (!q || [cafe.name, cafe.area, cafe.address].some((field) => field?.toLowerCase().includes(q))) &&
        (types.size === 0 || cafe.types.some((t) => types.has(t))) &&
        (tiers.size === 0 || (cafe.priceTier !== null && tiers.has(cafe.priceTier))) &&
        (!chargingOnly || cafe.charging === true) &&
        (!cdcOnly || cafe.cdcVouchers) &&
        (!hideChains || !cafe.chain),
    );
  }, [cafes, query, types, tiers, chargingOnly, cdcOnly, hideChains]);

  const filtering = query.trim() !== '' || types.size > 0 || tiers.size > 0 || chargingOnly || cdcOnly || hideChains;
  const chargingCount = useMemo(() => cafes.filter((c) => c.charging === true).length, [cafes]);
  const cdcCount = useMemo(() => cafes.filter((c) => c.cdcVouchers).length, [cafes]);
  const chainCount = useMemo(() => cafes.filter((c) => c.chain).length, [cafes]);
  const guideSources = useMemo(() => data?.sources.filter((s) => s.url.includes('eatbook.sg')) ?? [], [data]);
  const osmSource = data?.sources.find((s) => s.url.includes('openstreetmap.org'));
  const cdcSource = data?.sources.find((s) => s.url.includes('gowhere.gov.sg'));

  // Render a page of cards at a time; new filters start again from the first page. A café
  // focused from the map is always rendered, so its card can scroll into view.
  const filterKey = [query.trim(), [...types].join(), [...tiers].join(), chargingOnly, cdcOnly, hideChains].join('|');
  const [page, setPage] = useState({ key: filterKey, limit: PAGE });
  const limit = page.key === filterKey ? page.limit : PAGE;
  const focusedIndex = focusedCafeId ? filtered.findIndex((c) => c.id === focusedCafeId) : -1;
  const shown = filtered.slice(0, Math.max(limit, focusedIndex + 1));
  const savedPin = useCallback((cafe: Cafe) => pins.find((p) => sameName(p.name, cafe.name)), [pins]);

  // The map shows what the list shows. Cafés already on the trip are left to the trip's own pins.
  useEffect(() => {
    setCafeMarkers(
      filtered
        .filter((cafe): cafe is Cafe & { lat: number; lng: number } => cafe.lat !== null && cafe.lng !== null && !savedPin(cafe))
        .map(({ id, name, lat, lng, priceTier, types: cafeTypes, charging, cdcVouchers }) => ({
          id,
          name,
          lat,
          lng,
          priceTier,
          types: cafeTypes,
          charging,
          cdcVouchers,
        })),
    );
  }, [filtered, savedPin, setCafeMarkers]);

  // No clean-up on unmount: on phones this panel unmounts whenever the map is shown, and the
  // café layer has to stay. The map only draws it while the Cafés tab is active, and
  // switching trips clears it in the store.

  // A café clicked on the map: bring its card into view.
  useEffect(() => {
    if (!focusedCafeId) return;
    document.getElementById(`cafe-${focusedCafeId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusedCafeId]);

  const showOnMap = (cafe: Cafe) => {
    const pin = savedPin(cafe);
    if (pin) {
      selectPin(pin.id, { fly: true });
      return;
    }
    if (cafe.lat !== null && cafe.lng !== null) focusCafe({ id: cafe.id, lat: cafe.lat, lng: cafe.lng }, { fly: true });
  };

  const add = async (cafe: Cafe) => {
    if (cafe.lat === null || cafe.lng === null) return;
    setAdding(cafe.id);
    await addPin({
      name: cafe.name,
      address: cafe.address,
      lat: cafe.lat,
      lng: cafe.lng,
      category: 'food',
      notes: cafeNotes(cafe),
    });
    setAdding(null);
  };

  if (status === 'loading' && !data) {
    return (
      <div className="space-y-2.5" role="status" aria-label="Loading cafés">
        <p className="flex items-center gap-2 px-1 text-xs text-zinc-500">
          <LoaderCircle className="size-3.5 animate-spin text-indigo-400" />
          Reading Singapore café guides…
        </p>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-xl bg-zinc-800/50" />
        ))}
      </div>
    );
  }

  if (status === 'error' && !data) {
    return (
      <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-4 text-[13px] text-rose-200" role="alert">
        <p className="flex items-center gap-2 font-medium">
          <CircleAlert className="size-4 text-rose-400" /> Couldn’t load cafés
        </p>
        <p className="mt-1 text-xs text-rose-200/80">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-500/15 px-2.5 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-500/25"
        >
          <RotateCcw className="size-3.5" /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-zinc-700/50 bg-gradient-to-br from-zinc-800/80 to-zinc-800/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
              <Coffee className="size-4 text-amber-300" /> Singapore cafés
            </p>
            <p className="mt-0.5 text-xs text-zinc-400">
              {cafes.length} cafés from{' '}
              {joinSources(
                [
                  osmSource && (
                    <SourceLink key="osm" href={osmSource.url} title={`${osmSource.title}: ${osmSource.count} cafés`}>
                      OpenStreetMap
                    </SourceLink>
                  ),
                  guideSources.length > 0 && (
                    <SourceLink
                      key="eatbook"
                      href="https://eatbook.sg/"
                      title={guideSources.map((s) => `${s.title} (${s.count})`).join('\n')}
                    >
                      Eatbook guides
                    </SourceLink>
                  ),
                  cdcSource && (
                    <SourceLink key="cdc" href={cdcSource.url} title={`${cdcSource.title}: ${cdcSource.count} more cafés`}>
                      the CDC Vouchers directory
                    </SourceLink>
                  ),
                ].filter((link): link is ReactElement => Boolean(link)),
              )}
              {data?.scrapedAt && <> · updated {formatDistanceToNow(new Date(data.scrapedAt), { addSuffix: true })}</>}
              {data?.stale && <span className="text-amber-300"> · couldn’t refresh</span>}
            </p>
          </div>
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv(`singapore-cafes-${fileSlug(project.title)}.csv`, cafesToCsv(filtered))}
            title={filtering ? `Export the ${filtered.length} cafés shown` : 'Export all cafés'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
          >
            <Download className="size-3.5" /> Export CSV
          </button>
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Search cafés</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, area or street"
            className="w-full rounded-lg border border-zinc-700/60 bg-zinc-950/50 py-2 pr-8 pl-8 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-200"
            >
              <X className="size-3.5" />
            </button>
          )}
        </label>

        <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Café type">
          {FILTER_TYPES.map((type) => (
            <Chip key={type} active={types.has(type)} onClick={() => setTypes((s) => toggle(s, type))}>
              {CAFE_TYPE_LABELS[type]}
            </Chip>
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {PRICE_TIERS.map((tier) => (
            <Chip key={tier} active={tiers.has(tier)} onClick={() => setTiers((s) => toggle(s, tier))} title={TIER_HINT[tier]}>
              <span className="font-mono tracking-tight">{tier}</span>
            </Chip>
          ))}
          <span className="mx-0.5 h-4 w-px bg-zinc-700/70" aria-hidden />
          <Chip active={chargingOnly} onClick={() => setChargingOnly((v) => !v)} tone="amber">
            <Zap className="size-3" /> Charging ports
            <span className="text-[10px] opacity-70 tabular-nums">{chargingCount}</span>
          </Chip>
          <Chip
            active={cdcOnly}
            onClick={() => setCdcOnly((v) => !v)}
            tone="sky"
            title="Listed in the official CDC Vouchers directory, or in a guide to cafés that take them"
          >
            <Ticket className="size-3" /> CDC vouchers
            <span className="text-[10px] opacity-70 tabular-nums">{cdcCount}</span>
          </Chip>
          <Chip
            active={hideChains}
            onClick={() => setHideChains((v) => !v)}
            title="Hide Starbucks, Toast Box, Ya Kun and other cafés with four or more outlets"
          >
            <Store className="size-3" /> Hide chains
            <span className="text-[10px] opacity-70 tabular-nums">{chainCount}</span>
          </Chip>
        </div>
      </section>

      <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
        <span className="tabular-nums">
          {filtering ? `${filtered.length} of ${cafes.length} cafés` : `${cafes.length} cafés`}
        </span>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setTypes(new Set());
              setTiers(new Set());
              setChargingOnly(false);
              setCdcOnly(false);
              setHideChains(false);
            }}
            className="font-medium text-indigo-300 hover:text-indigo-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-700/60 px-4 py-8 text-center text-xs text-zinc-500">
          No cafés match. Try fewer filters.
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((cafe, i) => (
            <CafeCard
              key={cafe.id}
              cafe={cafe}
              index={i}
              added={Boolean(savedPin(cafe))}
              focused={focusedCafeId === cafe.id}
              canEdit={canEdit}
              busy={adding === cafe.id}
              onAdd={() => void add(cafe)}
              onShow={() => showOnMap(cafe)}
            />
          ))}
        </ul>
      )}

      {shown.length < filtered.length && (
        <button
          type="button"
          onClick={() => setPage({ key: filterKey, limit: shown.length + PAGE })}
          className="w-full rounded-xl border border-zinc-700/60 bg-zinc-800/40 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Show {Math.min(PAGE, filtered.length - shown.length)} more
          <span className="ml-1 text-zinc-500 tabular-nums">({filtered.length - shown.length} left)</span>
        </button>
      )}

      <p className="px-1 pt-1 text-[11px] leading-relaxed text-zinc-600">
        Click a café to find it on the map; the amber dots are the cafés listed here. Prices are dish prices quoted in the
        guides; the $ tier comes from a typical dish. Charging ports are shown only where a guide mentions them. CDC
        vouchers means the official CDC Vouchers directory lists the café at that address (or a guide says it takes
        them). Cafés found only in OpenStreetMap or the directory have no prices, and hours only where mappers added
        them. Details can change, so check the café, and look for the CDC decal, before you go.
        {osmSource && (
          <>
            {' '}
            Café data ©{' '}
            <a href={osmSource.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
              OpenStreetMap contributors
            </a>
            , ODbL.
          </>
        )}
      </p>
    </div>
  );
}

function SourceLink({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title} className="text-zinc-300 underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

/** "A", "A and B", "A, B and C". */
function joinSources(links: ReactElement[]): ReactNode[] {
  return links.flatMap((link, i) => (i === 0 ? [link] : [i === links.length - 1 ? ' and ' : ', ', link]));
}

const TIER_HINT: Record<PriceTier, string> = {
  $: 'Typical dish S$10 or less',
  $$: 'Typical dish S$10–25',
  $$$: 'Typical dish over S$25',
};

function CafeCard({
  cafe,
  index,
  added,
  focused,
  canEdit,
  busy,
  onAdd,
  onShow,
}: {
  cafe: Cafe;
  index: number;
  added: boolean;
  focused: boolean;
  canEdit: boolean;
  busy: boolean;
  onAdd: () => void;
  onShow: () => void;
}) {
  const price = formatPriceRange(cafe);
  const located = cafe.lat !== null && cafe.lng !== null;

  return (
    <motion.li
      id={`cafe-${cafe.id}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, delay: Math.min(index, 10) * 0.015 }}
      // Same pattern as the trip's pin cards: the card shows the place on the map, its buttons do their own thing.
      role={located ? 'button' : undefined}
      tabIndex={located ? 0 : undefined}
      aria-label={located ? `Show ${cafe.name} on the map` : undefined}
      aria-pressed={located ? focused : undefined}
      onClick={located ? onShow : undefined}
      onKeyDown={(e) => {
        if (located && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onShow();
        }
      }}
      className={cn(
        'rounded-xl border p-3.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60',
        located && 'cursor-pointer',
        focused
          ? 'border-amber-400/60 bg-zinc-800 ring-1 ring-amber-400/30'
          : 'border-zinc-700/50 bg-zinc-800/60 hover:border-zinc-600 hover:bg-zinc-800',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-zinc-100">{cafe.name}</p>
          {cafe.area && (
            <p className="flex items-center gap-1 truncate text-xs text-zinc-500">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{cafe.area}</span>
            </p>
          )}
        </div>
        {(price || cafe.priceTier) && (
          <span
            className="shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 tabular-nums"
            title="Dish prices quoted in the guide"
          >
            {price}
            {cafe.priceTier && <span className="ml-1 font-mono text-emerald-400/80">{cafe.priceTier}</span>}
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {cafe.types.map((type) => (
          <span key={type} className="rounded-md bg-zinc-700/50 px-1.5 py-0.5 text-[10.5px] font-medium text-zinc-300">
            {CAFE_TYPE_LABELS[type]}
          </span>
        ))}
        {cafe.charging === true && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-200">
            <Zap className="size-3" /> Charging ports
          </span>
        )}
        {cafe.charging === false && (
          <span className="inline-flex items-center gap-0.5 rounded-md bg-zinc-700/40 px-1.5 py-0.5 text-[10.5px] text-zinc-400">
            <ZapOff className="size-3" /> No charging
          </span>
        )}
        {cafe.cdcVouchers && (
          <span
            className="inline-flex items-center gap-0.5 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-sky-300"
            title="Takes CDC Vouchers"
          >
            <Ticket className="size-3" /> CDC vouchers
          </span>
        )}
        {(cafe.halal === 'certified' || cafe.halal === 'no-pork-lard') && (
          <span className="rounded-md bg-teal-500/10 px-1.5 py-0.5 text-[10.5px] font-medium text-teal-300">
            {HALAL_LABEL[cafe.halal]}
          </span>
        )}
      </div>

      {cafe.address && (
        <p className="mt-2 truncate text-xs text-zinc-500" title={cafe.address}>
          {cafe.address}
        </p>
      )}
      {cafe.hours && (
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500" title={cafe.hours}>
          <Clock className="size-3 shrink-0" />
          <span className="truncate">{cafe.hours}</span>
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-1.5">
        {canEdit && (
          <button
            type="button"
            disabled={added || busy || !located}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
            title={!located ? 'No map location found for this café' : added ? 'Already on this trip' : 'Add to Saved Places'}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors',
              added
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20 disabled:opacity-50',
            )}
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : added ? (
              <Check className="size-3.5" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {added ? 'Saved' : 'Add to Saved Places'}
          </button>
        )}
        <a
          href={cafe.sourceUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
          title={`${cafe.name} on ${cafe.sourceTitle}`}
        >
          {sourceLabel(cafe.sourceUrl)} <ExternalLink className="size-3" />
        </a>
      </div>
    </motion.li>
  );
}

function Chip({
  active,
  onClick,
  tone = 'indigo',
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: 'indigo' | 'amber' | 'sky';
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
        active
          ? tone === 'amber'
            ? 'border-amber-500/50 bg-amber-500/15 text-amber-100'
            : tone === 'sky'
              ? 'border-sky-500/50 bg-sky-500/15 text-sky-100'
              : 'border-indigo-500/50 bg-indigo-500/15 text-indigo-100'
          : 'border-zinc-700/70 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200',
      )}
    >
      {children}
    </button>
  );
}
