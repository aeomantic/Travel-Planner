'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, {
  Layer,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
  type ViewStateChangeEvent,
} from 'react-map-gl/maplibre';
import { LngLatBounds } from 'maplibre-gl';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Layers, LoaderCircle, MousePointerClick, Plus, Scan, X } from 'lucide-react';
import { PIN_CATEGORIES, UNASSIGNED, type BucketKey, type DayFilter, type PinCategory, type Project, type ProjectPin, type TripDay } from '@/types/trip';
import { CATEGORY_LABELS, matchesFilter, UNASSIGNED_COLOR, type PinDisplayMeta } from '@/lib/itinerary';
import { reverseGeocode } from '@/lib/geocode';
import { useItinerary } from '@/hooks/useItinerary';
import { useTripStore, type CameraCommand, type DraftPin } from '@/store/useTripStore';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { SidebarToggle } from '@/components/PrimarySidebar';
import { cn } from '@/lib/utils';

/** Free, keyless vector basemap. */
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const INITIAL_VIEW = { longitude: 139.65, latitude: 35.67, zoom: 1.6 };
const FIT_PADDING = { top: 110, bottom: 70, left: 70, right: 80 };
/** Narrow maps: keep the frame clear of the filter panel and the mobile Map/Itinerary pill. */
const FIT_PADDING_COMPACT = { top: 120, bottom: 90, left: 36, right: 36 };
/** Wait for the drawer's width animation to settle before framing. */
const FIT_SETTLE_MS = 140;
const FIT_MAX_WAIT_MS = 900;

interface LineFeature {
  type: 'Feature';
  properties: { day: string; color: string };
  geometry: { type: 'LineString'; coordinates: [number, number][] };
}
interface LineCollection {
  type: 'FeatureCollection';
  features: LineFeature[];
}

const routeCasing: LayerProps = {
  id: 'route-casing',
  type: 'line',
  layout: { 'line-cap': 'round', 'line-join': 'round' },
  paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': 0.1, 'line-blur': 3 },
};

const routeLine: LayerProps = {
  id: 'route-line',
  type: 'line',
  layout: { 'line-cap': 'butt', 'line-join': 'round' },
  paint: { 'line-color': ['get', 'color'], 'line-width': 2.25, 'line-opacity': 0.85, 'line-dasharray': [2.5, 2] },
};

interface VisiblePin {
  pin: ProjectPin;
  meta: PinDisplayMeta;
}

export default function MapCanvas() {
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  const activeProjectId = useTripStore((s) => s.activeProjectId);
  const projects = useTripStore((s) => s.projects);
  const dayFilter = useTripStore((s) => s.dayFilter);
  const cameraCommand = useTripStore((s) => s.cameraCommand);
  const draftPin = useTripStore((s) => s.draftPin);
  const hoveredPinId = useTripStore((s) => s.hoveredPinId);
  const pinsStatus = useTripStore((s) => (activeProjectId ? s.pinsStatus[activeProjectId] : undefined));
  const setDraftPin = useTripStore((s) => s.setDraftPin);
  const selectPin = useTripStore((s) => s.selectPin);
  const setMapCenter = useTripStore((s) => s.setMapCenter);
  const setActiveProject = useTripStore((s) => s.setActiveProject);
  const mobile = useTripStore((s) => s.viewport === 'mobile');

  const { project, pins, days, meta } = useItinerary(activeProjectId);

  const visible = useMemo<VisiblePin[]>(() => {
    const list: VisiblePin[] = [];
    for (const pin of pins) {
      const m = meta.get(pin.id);
      if (m && matchesFilter(m.bucket, dayFilter)) list.push({ pin, meta: m });
    }
    // Saved Places first so numbered day markers paint on top.
    return list.sort((a, b) => Number(a.meta.number !== null) - Number(b.meta.number !== null));
  }, [pins, meta, dayFilter]);

  const routes = useMemo<LineCollection>(() => {
    const byDay = new globalThis.Map<string, VisiblePin[]>();
    for (const item of visible) {
      if (item.meta.bucket === UNASSIGNED) continue;
      const list = byDay.get(item.meta.bucket) ?? [];
      list.push(item);
      byDay.set(item.meta.bucket, list);
    }
    const features: LineFeature[] = [];
    for (const [day, items] of byDay) {
      if (items.length < 2) continue;
      const ordered = [...items].sort((a, b) => (a.meta.number ?? 0) - (b.meta.number ?? 0));
      features.push({
        type: 'Feature',
        properties: { day, color: ordered[0]?.meta.color ?? UNASSIGNED_COLOR },
        geometry: { type: 'LineString', coordinates: ordered.map(({ pin }) => [pin.lng, pin.lat]) },
      });
    }
    return { type: 'FeatureCollection', features };
  }, [visible]);

  const hoveredDay = hoveredPinId ? meta.get(hoveredPinId)?.bucket : undefined;
  const routeHighlight = useMemo<LayerProps>(
    () => ({
      id: 'route-highlight',
      type: 'line',
      filter: ['==', ['get', 'day'], hoveredDay ?? '__none__'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 4, 'line-opacity': 0.45 },
    }),
    [hoveredDay],
  );

  /* ------------------------------------------------------------ camera --- */

  const fitNow = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: [number, number][] = project
      ? visible.map(({ pin }) => [pin.lng, pin.lat])
      : projects.map((p) => [p.center_lng, p.center_lat]);

    if (points.length === 0) {
      if (project) map.flyTo({ center: [project.center_lng, project.center_lat], zoom: 11.5, duration: 1100, essential: true });
      else map.flyTo({ center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude], zoom: INITIAL_VIEW.zoom, duration: 1100 });
      return;
    }
    const [first] = points;
    if (points.length === 1 && first) {
      map.flyTo({ center: first, zoom: project ? 14 : 4, duration: 1100, essential: true });
      return;
    }
    const bounds = points.reduce((b, point) => b.extend(point), new LngLatBounds(points[0], points[0]));
    const compact = (containerRef.current?.clientWidth ?? 1024) < 640;
    map.fitBounds(bounds, {
      padding: compact ? FIT_PADDING_COMPACT : FIT_PADDING,
      maxZoom: project ? 14.5 : 5,
      duration: 1200,
      essential: true,
    });
  }, [project, projects, visible]);

  const fitRef = useRef(fitNow);
  useEffect(() => {
    fitRef.current = fitNow;
  }, [fitNow]);

  const fitTimer = useRef<number | null>(null);
  const fitRequestedAt = useRef(0);

  const scheduleFit = useCallback((delay: number) => {
    if (fitTimer.current !== null) window.clearTimeout(fitTimer.current);
    fitTimer.current = window.setTimeout(() => {
      fitTimer.current = null;
      fitRef.current();
    }, delay);
  }, []);

  // Keep the canvas matched to its container as the drawer slides; postpone any
  // pending fit until the size settles so bounds are computed at the final width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => mapRef.current?.resize());
      if (fitTimer.current !== null && performance.now() - fitRequestedAt.current < FIT_MAX_WAIT_MS) {
        scheduleFit(FIT_SETTLE_MS);
      }
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [scheduleFit]);

  const handledCommand = useRef<number>(0);
  useEffect(() => {
    if (!loaded || !cameraCommand || cameraCommand.id === handledCommand.current) return;
    handledCommand.current = cameraCommand.id;
    runCamera(cameraCommand);
  });

  function runCamera(command: CameraCommand) {
    if (command.kind === 'fly') {
      mapRef.current?.flyTo({ center: [command.lng, command.lat], zoom: command.zoom, duration: 1200, essential: true });
    } else {
      fitRequestedAt.current = performance.now();
      scheduleFit(FIT_SETTLE_MS);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setDraftPin(null);
      selectPin(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDraftPin, selectPin]);

  useEffect(
    () => () => {
      if (fitTimer.current !== null) window.clearTimeout(fitTimer.current);
    },
    [],
  );

  /* ------------------------------------------------------------ events --- */

  const onMapClick = (e: MapLayerMouseEvent) => {
    if (!project) return;
    selectPin(null);
    if (draftPin) setDraftPin(null);
    else setDraftPin({ lng: e.lngLat.lng, lat: e.lngLat.lat });
  };

  const onMoveEnd = (e: ViewStateChangeEvent) => {
    setMapCenter({ lat: e.viewState.latitude, lng: e.viewState.longitude });
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0e0e10]">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={{ compact: true }}
        cursor={project ? 'crosshair' : 'grab'}
        onLoad={() => setLoaded(true)}
        onClick={onMapClick}
        onMoveEnd={onMoveEnd}
        onError={(e) => console.warn('[map]', e.error?.message)}
        dragRotate={false}
        maxPitch={0}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {project && (
          <Source id="routes" type="geojson" data={routes}>
            <Layer {...routeCasing} />
            <Layer {...routeHighlight} />
            <Layer {...routeLine} />
          </Source>
        )}

        {project && visible.map(({ pin, meta: m }) => <PinMarker key={pin.id} pin={pin} meta={m} />)}

        {!project &&
          projects.map((p) => <ProjectMarker key={p.id} project={p} onOpen={() => setActiveProject(p.id)} />)}

        {project && draftPin && <DropPinPopup key={`${draftPin.lat},${draftPin.lng}`} draft={draftPin} days={days} filter={dayFilter} />}
      </Map>

      {/* When a workspace drawer is docked, its header carries the toggle instead. */}
      {(!project || mobile) && <SidebarToggle className="absolute top-4 left-4 z-10" />}

      <AnimatePresence>
        {project && <DayFilterPanel key="filters" days={days} savedCount={pins.filter((p) => meta.get(p.id)?.bucket === UNASSIGNED).length} />}
      </AnimatePresence>

      {project && pinsStatus === 'loading' && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-700/60 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur-md">
          <LoaderCircle className="size-3.5 animate-spin" /> Loading places…
        </div>
      )}

      {project ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-2 rounded-xl sm:flex border border-zinc-700/60 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-400 backdrop-blur-md">
          <MousePointerClick className="size-3.5 text-indigo-400" />
          Click the map to drop a pin · drag markers to move them
        </div>
      ) : (
        <div className="pointer-events-none absolute top-16 left-1/2 z-10 -translate-x-1/2 rounded-xl border whitespace-nowrap sm:top-5 border-zinc-700/60 bg-zinc-900/80 px-4 py-2.5 text-center backdrop-blur-md">
          <p className="text-sm font-medium text-zinc-100">Pick a trip to start planning</p>
          <p className="text-xs text-zinc-500">Or create one with New Trip</p>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Markers                                                                    */
/* -------------------------------------------------------------------------- */

const PinMarker = memo(function PinMarker({ pin, meta }: { pin: ProjectPin; meta: PinDisplayMeta }) {
  const hovered = useTripStore((s) => s.hoveredPinId === pin.id);
  const selected = useTripStore((s) => s.selectedPinId === pin.id);
  const setHoveredPin = useTripStore((s) => s.setHoveredPin);
  const selectPin = useTripStore((s) => s.selectPin);
  const updatePin = useTripStore((s) => s.updatePin);
  const lifted = hovered || selected;

  return (
    <Marker
      longitude={pin.lng}
      latitude={pin.lat}
      anchor="center"
      draggable
      style={{ zIndex: lifted ? 30 : meta.number !== null ? 2 : 1 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        selectPin(pin.id, { reveal: true });
      }}
      onDragEnd={(e) => void updatePin(pin.id, { lat: e.lngLat.lat, lng: e.lngLat.lng })}
    >
      <div
        className="relative"
        onMouseEnter={() => setHoveredPin(pin.id)}
        onMouseLeave={() => setHoveredPin(null)}
      >
        <div
          role="button"
          aria-label={`${pin.name}${meta.dayIndex ? `, day ${meta.dayIndex} stop ${meta.number}` : ', saved place'}`}
          className={cn(
            'grid size-7 cursor-pointer place-items-center rounded-full border-2 border-zinc-950 text-[11px] font-semibold text-white shadow-[0_4px_14px_rgba(0,0,0,0.5)] transition-all duration-200 ease-out tabular-nums',
            lifted && 'scale-125 ring-4 ring-indigo-500/40',
            meta.number === null && !lifted && 'size-6 opacity-90',
          )}
          style={{ backgroundColor: meta.color }}
        >
          {meta.number ?? <Bookmark className="size-3" strokeWidth={2.75} />}
        </div>
        <AnimatePresence>
          {lifted && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.14 }}
              className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 rounded-lg border border-zinc-700/70 bg-zinc-900/95 px-2.5 py-1.5 whitespace-nowrap shadow-xl backdrop-blur-md"
            >
              <p className="text-xs font-medium text-zinc-100">{pin.name}</p>
              <p className="flex items-center gap-1 text-[10.5px] text-zinc-400">
                <CategoryIcon category={pin.category} className="size-3" />
                {CATEGORY_LABELS[pin.category]}
                {meta.dayIndex !== null && <span style={{ color: meta.color }}>· Day {meta.dayIndex}</span>}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Marker>
  );
});

function ProjectMarker({ project, onOpen }: { project: Project; onOpen: () => void }) {
  return (
    <Marker
      longitude={project.center_lng}
      latitude={project.center_lat}
      anchor="bottom"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onOpen();
      }}
    >
      <button type="button" className="group flex cursor-pointer flex-col items-center">
        <span className="rounded-full border border-zinc-700/70 bg-zinc-900/90 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-zinc-100 shadow-lg backdrop-blur-md transition-colors group-hover:border-indigo-500/70">
          {project.title}
        </span>
        <span className="h-2 w-px bg-zinc-600" />
        <span className="size-2.5 rounded-full bg-indigo-500 ring-4 ring-indigo-500/25 transition-transform group-hover:scale-125" />
      </button>
    </Marker>
  );
}

/* -------------------------------------------------------------------------- */
/*  Day filter controls                                                        */
/* -------------------------------------------------------------------------- */

function DayFilterPanel({ days, savedCount }: { days: TripDay[]; savedCount: number }) {
  const dayFilter = useTripStore((s) => s.dayFilter);
  const setDayFilter = useTripStore((s) => s.setDayFilter);
  const requestFit = useTripStore((s) => s.requestFit);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="absolute top-4 right-4 z-10 flex max-w-[min(360px,calc(100%-76px))] items-start gap-2"
    >
      <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/80 p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <p className="flex items-center gap-1.5 px-1.5 pt-0.5 pb-1.5 text-[11px] font-medium text-zinc-400">
          <Layers className="size-3.5" /> Show on map
        </p>
        <div className="scrollbar-thin flex max-h-[40vh] flex-wrap gap-1 overflow-y-auto" role="radiogroup" aria-label="Filter map by day">
          <FilterChip active={dayFilter === 'all'} onClick={() => setDayFilter('all')}>
            All Days
          </FilterChip>
          {days.map((day) => (
            <FilterChip key={day.date} active={dayFilter === day.date} color={day.color} onClick={() => setDayFilter(day.date)}>
              Day {day.index}
            </FilterChip>
          ))}
          {savedCount > 0 && (
            <FilterChip active={dayFilter === UNASSIGNED} color={UNASSIGNED_COLOR} onClick={() => setDayFilter(UNASSIGNED)}>
              Saved
            </FilterChip>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={requestFit}
        title="Fit map to places"
        aria-label="Fit map to places"
        className="grid size-[38px] shrink-0 place-items-center rounded-xl border border-zinc-700/60 bg-zinc-900/80 text-zinc-300 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-zinc-50"
      >
        <Scan className="size-4" />
      </button>
    </motion.div>
  );
}

function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
        active ? 'bg-zinc-100 text-zinc-900 shadow-sm' : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50',
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Drop-a-pin popup                                                           */
/* -------------------------------------------------------------------------- */

function DropPinPopup({ draft, days, filter }: { draft: DraftPin; days: TripDay[]; filter: DayFilter }) {
  const setDraftPin = useTripStore((s) => s.setDraftPin);
  const addPin = useTripStore((s) => s.addPin);
  const [name, setName] = useState('');
  const [address, setAddress] = useState<string | null>(null);
  const [category, setCategory] = useState<PinCategory>('sightseeing');
  const [bucket, setBucket] = useState<BucketKey>(filter === 'all' ? UNASSIGNED : filter);
  const [looking, setLooking] = useState(true);
  const touched = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    reverseGeocode(draft.lat, draft.lng, controller.signal)
      .then((place) => {
        if (!place) return;
        setAddress(place.address || null);
        setCategory(place.category);
        if (!touched.current) setName(place.name);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLooking(false);
      });
    return () => controller.abort();
  }, [draft.lat, draft.lng]);

  const submit = () => {
    void addPin({
      name: name.trim() || 'Dropped pin',
      address,
      lat: draft.lat,
      lng: draft.lng,
      category,
      day_date: bucket === UNASSIGNED ? null : bucket,
    });
    setDraftPin(null);
  };

  return (
    <>
      <Marker longitude={draft.lng} latitude={draft.lat} anchor="center">
        <span className="relative grid size-4 place-items-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-indigo-400/60" />
          <span className="size-3 rounded-full border-2 border-white bg-indigo-500" />
        </span>
      </Marker>
      <Popup
        longitude={draft.lng}
        latitude={draft.lat}
        anchor="bottom"
        offset={16}
        closeButton={false}
        closeOnClick={false}
        maxWidth="300px"
        onClose={() => setDraftPin(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="w-[280px] rounded-xl border border-zinc-700/70 bg-zinc-900/[0.96] p-3 text-zinc-100 shadow-2xl backdrop-blur-md"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-200">Drop a pin here</p>
            <button
              type="button"
              onClick={() => setDraftPin(null)}
              className="rounded-md p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Cancel"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="relative">
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                touched.current = true;
                setName(e.target.value);
              }}
              placeholder={looking ? 'Looking up this spot…' : 'Name this place'}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950/70 px-2.5 py-1.5 pr-7 text-sm placeholder:text-zinc-500 focus:border-indigo-500/60 focus:outline-none"
            />
            {looking && <LoaderCircle className="absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-zinc-500" />}
          </div>
          <p className="mt-1.5 truncate px-0.5 text-[11px] text-zinc-500">
            {address ?? `${draft.lat.toFixed(5)}, ${draft.lng.toFixed(5)}`}
          </p>
          <div className="mt-2.5 flex gap-1.5">
            <select
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500/60 focus:outline-none"
              aria-label="Add to"
            >
              <option value={UNASSIGNED}>Saved Places</option>
              {days.map((day) => (
                <option key={day.date} value={day.date}>
                  Day {day.index} · {day.label}
                </option>
              ))}
            </select>
            <select
              value={category}
              onChange={(e) => setCategory(PIN_CATEGORIES.find((c) => c === e.target.value) ?? 'other')}
              className="w-[108px] rounded-lg border border-zinc-700 bg-zinc-950/70 px-2 py-1.5 text-xs text-zinc-200 focus:border-indigo-500/60 focus:outline-none"
              aria-label="Category"
            >
              {PIN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <Plus className="size-3.5" /> Add place
          </button>
        </form>
      </Popup>
    </>
  );
}
