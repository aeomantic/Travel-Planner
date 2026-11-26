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
import { Bookmark, Coffee, Eye, Layers, LoaderCircle, MousePointerClick, Plus, Scan, Ticket, X, Zap } from 'lucide-react';
import { PIN_CATEGORIES, UNASSIGNED, type BucketKey, type DayFilter, type PinCategory, type Project, type ProjectPin, type TripDay } from '@/types/trip';
import { CATEGORY_LABELS, matchesFilter, tripColorMap, UNASSIGNED_COLOR, type PinDisplayMeta } from '@/lib/itinerary';
import { reverseGeocode } from '@/lib/geocode';
import { useItinerary } from '@/hooks/useItinerary';
import {
  folderTrips,
  selectActiveFolder,
  selectCanEdit,
  useTripStore,
  type CafeMarker,
  type CameraCommand,
  type DraftPin,
} from '@/store/useTripStore';
import { CAFE_TYPE_LABELS } from '@/lib/cafes/types';
import type { TravelFolder } from '@/types/trip';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { SidebarToggle } from '@/components/PrimarySidebar';
import { cn } from '@/lib/utils';

/** Free, keyless vector basemap. */
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const INITIAL_VIEW = { longitude: 139.65, latitude: 35.67, zoom: 1.6 };
const FIT_PADDING = { top: 110, bottom: 70, left: 70, right: 80 };
/** Phones: keep the frame clear of the top bar + day strip (and the notch), and the bottom sheet pill. */
const FIT_PADDING_COMPACT = { top: 150, bottom: 120, left: 36, right: 56 };
const COMPACT_MAX_WIDTH = 768;
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

const EMPTY_CAFES: CafeMarker[] = [];

interface PointCollection {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: { id: string }; geometry: { type: 'Point'; coordinates: [number, number] } }[];
}

/**
 * The Cafés tab's cafés, drawn by the GPU: there can be several hundred, too many for DOM markers.
 * The hovered or focused one also gets a DOM marker (CafePinMarker) with its name.
 */
const CAFE_LAYER_ID = 'cafe-dots';
const cafeDots: LayerProps = {
  id: CAFE_LAYER_ID,
  type: 'circle',
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3.5, 14, 6, 17, 8],
    'circle-color': '#fbbf24',
    'circle-opacity': 0.85,
    'circle-stroke-color': '#09090b',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2],
  },
};

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
  const canEdit = useTripStore(selectCanEdit);

  const { project, pins, days, meta } = useItinerary(activeProjectId);
  const savedCount = useMemo(() => pins.filter((p) => meta.get(p.id)?.bucket === UNASSIGNED).length, [pins, meta]);
  // Cafés tab: the panel's filtered cafés, drawn under the trip's own pins.
  const showCafes = useTripStore((s) => s.activeTab === 'cafes');
  const allCafeMarkers = useTripStore((s) => s.cafeMarkers);
  const cafeMarkers = showCafes ? allCafeMarkers : EMPTY_CAFES;
  const focusCafe = useTripStore((s) => s.focusCafe);
  const focusedCafeId = useTripStore((s) => s.focusedCafeId);
  const [hoveredCafeId, setHoveredCafeId] = useState<string | null>(null);
  const cafeById = useMemo(() => new globalThis.Map(cafeMarkers.map((c) => [c.id, c])), [cafeMarkers]);
  const cafePoints = useMemo<PointCollection>(
    () => ({
      type: 'FeatureCollection',
      features: cafeMarkers.map((c) => ({
        type: 'Feature',
        properties: { id: c.id },
        geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
      })),
    }),
    [cafeMarkers],
  );
  const liftedCafes = [...new Set([focusedCafeId, hoveredCafeId])]
    .map((id) => (id ? cafeById.get(id) : undefined))
    .filter((c): c is CafeMarker => c !== undefined);

  // Project Overview: every trip in the folder at once, one colour per trip.
  const activeFolder = useTripStore(selectActiveFolder);
  const folderPins = useTripStore((s) => s.folderPins);
  const folderPinsStatus = useTripStore((s) => s.folderPinsStatus);
  const overview = !project ? activeFolder : undefined;
  const overviewTrips = useMemo(() => (overview ? folderTrips(overview, projects) : []), [overview, projects]);
  const tripColors = useMemo(() => tripColorMap(overviewTrips.map((t) => t.id)), [overviewTrips]);
  const tripTitles = useMemo(() => new globalThis.Map(overviewTrips.map((t) => [t.id, t.title])), [overviewTrips]);
  const overviewPins = useMemo(
    () => (overview ? folderPins.filter((pin) => tripColors.has(pin.project_id)) : []),
    [overview, folderPins, tripColors],
  );

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
      ? [...visible.map(({ pin }): [number, number] => [pin.lng, pin.lat]), ...cafeMarkers.map((c): [number, number] => [c.lng, c.lat])]
      : overview
        ? overviewPins.length > 0
          ? overviewPins.map((pin) => [pin.lng, pin.lat])
          : overviewTrips.map((t) => [t.center_lng, t.center_lat])
        : projects.map((p) => [p.center_lng, p.center_lat]);

    if (points.length === 0) {
      if (project) map.flyTo({ center: [project.center_lng, project.center_lat], zoom: 11.5, duration: 1100, essential: true });
      else map.flyTo({ center: [INITIAL_VIEW.longitude, INITIAL_VIEW.latitude], zoom: INITIAL_VIEW.zoom, duration: 1100 });
      return;
    }
    const [first] = points;
    if (points.length === 1 && first) {
      map.flyTo({ center: first, zoom: project ? 14 : overview ? 11 : 4, duration: 1100, essential: true });
      return;
    }
    const bounds = points.reduce((b, point) => b.extend(point), new LngLatBounds(points[0], points[0]));
    const compact = (containerRef.current?.clientWidth ?? 1024) < COMPACT_MAX_WIDTH;
    map.fitBounds(bounds, {
      padding: compact ? FIT_PADDING_COMPACT : FIT_PADDING,
      // An overview frames a whole country/region, so it may zoom in further than the world view.
      maxZoom: project ? 14.5 : overview ? 12 : 5,
      duration: 1200,
      essential: true,
    });
  }, [project, projects, visible, cafeMarkers, overview, overviewPins, overviewTrips]);

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
      focusCafe(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setDraftPin, selectPin, focusCafe]);

  useEffect(
    () => () => {
      if (fitTimer.current !== null) window.clearTimeout(fitTimer.current);
    },
    [],
  );

  /* ------------------------------------------------------------ events --- */

  const cafeAt = (e: MapLayerMouseEvent): CafeMarker | undefined => {
    const id: unknown = e.features?.find((f) => f.layer.id === CAFE_LAYER_ID)?.properties?.id;
    return typeof id === 'string' ? cafeById.get(id) : undefined;
  };

  const onMapClick = (e: MapLayerMouseEvent) => {
    if (!project) return;
    const cafe = cafeAt(e);
    if (cafe) {
      focusCafe(cafe);
      return;
    }
    selectPin(null);
    focusCafe(null);
    // Viewers can pan and inspect, but never drop pins.
    if (draftPin || !canEdit) setDraftPin(null);
    else setDraftPin({ lng: e.lngLat.lng, lat: e.lngLat.lat });
  };

  const onMoveEnd = (e: ViewStateChangeEvent) => {
    setMapCenter({ lat: e.viewState.latitude, lng: e.viewState.longitude });
  };

  // Cleared here and when the pointer leaves the café's DOM marker, not on the layer's mouseleave,
  // which fires as soon as that marker appears under the pointer.
  const onMouseMove = (e: MapLayerMouseEvent) => {
    const id = cafeAt(e)?.id ?? null;
    if (id !== hoveredCafeId) setHoveredCafeId(id);
  };
  const unhoverCafe = useCallback((id: string) => setHoveredCafeId((current) => (current === id ? null : current)), []);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0e0e10]">
      <Map
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={{ compact: true }}
        cursor={hoveredCafeId ? 'pointer' : project && canEdit ? 'crosshair' : 'grab'}
        interactiveLayerIds={project ? [CAFE_LAYER_ID] : undefined}
        onLoad={() => setLoaded(true)}
        onClick={onMapClick}
        onMouseMove={project ? onMouseMove : undefined}
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

        {project && (
          <Source id="cafes" type="geojson" data={cafePoints}>
            <Layer {...cafeDots} />
          </Source>
        )}

        {project && liftedCafes.map((cafe) => <CafePinMarker key={cafe.id} cafe={cafe} onLeave={unhoverCafe} />)}

        {project && visible.map(({ pin, meta: m }) => <PinMarker key={pin.id} pin={pin} meta={m} />)}

        {overview &&
          overviewPins.map((pin) => (
            <FolderPinMarker
              key={pin.id}
              pin={pin}
              color={tripColors.get(pin.project_id) ?? overview.color_hex}
              tripTitle={tripTitles.get(pin.project_id) ?? ''}
            />
          ))}

        {!project &&
          !overview &&
          projects.map((p) => <ProjectMarker key={p.id} project={p} onOpen={() => setActiveProject(p.id)} />)}

        {project && canEdit && draftPin && <DropPinPopup key={`${draftPin.lat},${draftPin.lng}`} draft={draftPin} days={days} filter={dayFilter} />}
      </Map>

      {/* When a workspace drawer is docked, its header carries the toggle instead; phones use the top bar. */}
      {!project && !overview && <SidebarToggle className="absolute top-4 left-4 z-10" />}

      <AnimatePresence>
        {project &&
          (mobile ? (
            <MobileDayStrip key="strip" days={days} savedCount={savedCount} />
          ) : (
            <DayFilterPanel key="filters" days={days} savedCount={savedCount} />
          ))}
        {overview &&
          (mobile ? (
            <MobileTripStrip key={`trip-strip:${overview.id}`} trips={overviewTrips} colors={tripColors} />
          ) : (
            <FolderLegend key={`legend:${overview.id}`} folder={overview} trips={overviewTrips} colors={tripColors} />
          ))}
      </AnimatePresence>

      {((project && pinsStatus === 'loading') || (overview && folderPinsStatus === 'loading')) && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-zinc-700/60 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-300 backdrop-blur-md max-md:top-[calc(max(0.75rem,env(safe-area-inset-top))+6.25rem)]">
          <LoaderCircle className="size-3.5 animate-spin" /> Loading places…
        </div>
      )}

      {project ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-2 rounded-xl sm:flex border border-zinc-700/60 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-400 backdrop-blur-md">
          {canEdit ? (
            <>
              <MousePointerClick className="size-3.5 text-indigo-400" />
              Click the map to drop a pin · drag markers to move them
            </>
          ) : (
            <>
              <Eye className="size-3.5 text-zinc-300" />
              View only · click a marker to see its details
            </>
          )}
        </div>
      ) : overview ? (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden items-center gap-2 rounded-xl sm:flex border border-zinc-700/60 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-400 backdrop-blur-md">
          <MousePointerClick className="size-3.5" style={{ color: overview.color_hex }} />
          {overview.name} overview · click a pin to open its trip
        </div>
      ) : (
        // Phones say this in the top bar instead.
        <div className="pointer-events-none absolute top-5 left-1/2 z-10 -translate-x-1/2 rounded-xl border whitespace-nowrap border-zinc-700/60 bg-zinc-900/80 px-4 py-2.5 text-center backdrop-blur-md max-md:hidden">
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
  const canEdit = useTripStore(selectCanEdit);
  const lifted = hovered || selected;

  return (
    <Marker
      longitude={pin.lng}
      latitude={pin.lat}
      anchor="center"
      // Dragging writes lat/lng to `places` (by place_id), so it's editors and owners only.
      draggable={canEdit}
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

/**
 * The hovered or focused café from the Cafés tab, raised above its dot in the café layer with
 * its name; clicking highlights it in the list.
 */
const CafePinMarker = memo(function CafePinMarker({ cafe, onLeave }: { cafe: CafeMarker; onLeave: (id: string) => void }) {
  const focused = useTripStore((s) => s.focusedCafeId === cafe.id);
  const focusCafe = useTripStore((s) => s.focusCafe);
  const kind = CAFE_TYPE_LABELS[cafe.types[0] ?? 'cafe'];

  return (
    <Marker
      longitude={cafe.lng}
      latitude={cafe.lat}
      anchor="center"
      style={{ zIndex: 25 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        focusCafe(cafe);
      }}
    >
      <div className="relative" onMouseLeave={() => onLeave(cafe.id)}>
        <motion.div
          role="button"
          aria-label={`${cafe.name}, café`}
          aria-pressed={focused}
          initial={{ scale: 0.75 }}
          animate={{ scale: 1.35 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="grid size-5 cursor-pointer place-items-center rounded-full border-2 border-zinc-950 bg-amber-400 text-zinc-950 shadow-[0_2px_10px_rgba(0,0,0,0.55)] ring-4 ring-amber-400/35"
        >
          <Coffee className="size-2.5" strokeWidth={3} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 rounded-lg border border-zinc-700/70 bg-zinc-900/95 px-2.5 py-1.5 whitespace-nowrap shadow-xl backdrop-blur-md"
        >
          <p className="text-xs font-medium text-zinc-100">{cafe.name}</p>
          <p className="flex items-center gap-1 text-[10.5px] text-zinc-400">
            <Coffee className="size-3 text-amber-300" />
            {kind}
            {cafe.priceTier && <span className="font-mono text-emerald-300">· {cafe.priceTier}</span>}
            {cafe.charging === true && (
              <span className="inline-flex items-center gap-0.5 text-amber-200">
                · <Zap className="size-3" /> Charging
              </span>
            )}
            {cafe.cdcVouchers && (
              <span className="inline-flex items-center gap-0.5 text-sky-300">
                · <Ticket className="size-3" /> CDC
              </span>
            )}
          </p>
        </motion.div>
      </div>
    </Marker>
  );
});

/** Overview pin: a small dot in its trip's colour; clicking opens that trip at this place. */
const FolderPinMarker = memo(function FolderPinMarker({
  pin,
  color,
  tripTitle,
}: {
  pin: ProjectPin;
  color: string;
  tripTitle: string;
}) {
  const [hovered, setHovered] = useState(false);
  const setActiveProject = useTripStore((s) => s.setActiveProject);
  const selectPin = useTripStore((s) => s.selectPin);

  return (
    <Marker
      longitude={pin.lng}
      latitude={pin.lat}
      anchor="center"
      style={{ zIndex: hovered ? 30 : 1 }}
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        setActiveProject(pin.project_id);
        selectPin(pin.id, { fly: true, reveal: true });
      }}
    >
      <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
        <div
          role="button"
          aria-label={`${pin.name}, ${tripTitle}`}
          className={cn(
            'size-3.5 cursor-pointer rounded-full border-2 border-zinc-950 transition-transform duration-150',
            hovered && 'scale-150',
          )}
          style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}aa, 0 2px 8px rgba(0,0,0,0.5)` }}
        />
        <AnimatePresence>
          {hovered && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.12 }}
              className="pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 rounded-lg border border-zinc-700/70 bg-zinc-900/95 px-2.5 py-1.5 whitespace-nowrap shadow-xl backdrop-blur-md"
            >
              <p className="text-xs font-medium text-zinc-100">{pin.name}</p>
              <p className="flex items-center gap-1 text-[10.5px] text-zinc-400">
                <CategoryIcon category={pin.category} className="size-3" />
                {CATEGORY_LABELS[pin.category]}
                <span style={{ color }}>· {tripTitle}</span>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Marker>
  );
});

function FolderLegend({ folder, trips, colors }: { folder: TravelFolder; trips: Project[]; colors: Map<string, string> }) {
  const setActiveProject = useTripStore((s) => s.setActiveProject);
  const requestFit = useTripStore((s) => s.requestFit);

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className="absolute top-4 right-4 z-10 flex max-w-[min(300px,calc(100%-76px))] items-start gap-2"
    >
      <div className="min-w-0 rounded-xl border border-zinc-700/60 bg-zinc-900/80 p-1.5 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md">
        <p className="flex items-center gap-1.5 px-1.5 pt-0.5 pb-1.5 text-[11px] font-medium text-zinc-400">
          <Layers className="size-3.5" style={{ color: folder.color_hex }} />
          <span className="truncate">{folder.name}</span>
          <span className="text-zinc-600">·</span>
          {trips.length} trip{trips.length === 1 ? '' : 's'}
        </p>
        <div className="scrollbar-thin flex max-h-[40vh] flex-col gap-0.5 overflow-y-auto">
          {trips.map((trip) => (
            <button
              key={trip.id}
              type="button"
              onClick={() => setActiveProject(trip.id)}
              title={`Open ${trip.title}`}
              className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
            >
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colors.get(trip.id) }} />
              <span className="truncate">{trip.title}</span>
            </button>
          ))}
          {trips.length === 0 && <p className="px-2 py-1 text-xs text-zinc-500">No trips yet</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={requestFit}
        title="Fit map to all trips"
        aria-label="Fit map to all trips"
        className="grid size-[38px] shrink-0 place-items-center rounded-xl border border-zinc-700/60 bg-zinc-900/80 text-zinc-300 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md transition-colors hover:bg-zinc-800 hover:text-zinc-50"
      >
        <Scan className="size-4" />
      </button>
    </motion.div>
  );
}

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
/*  Phone filter strips: one scrollable row under the top bar                  */
/* -------------------------------------------------------------------------- */

/** Sits just below MobileTopBar (same safe-area maths: its top + 3rem tall + 0.5rem gap). */
const STRIP_POSITION = 'absolute inset-x-0 top-[calc(max(0.75rem,env(safe-area-inset-top))+3.5rem)] z-20 md:hidden';

function MobileStrip({
  label,
  role = 'radiogroup',
  children,
}: {
  label: string;
  role?: 'radiogroup' | 'toolbar';
  children: React.ReactNode;
}) {
  const requestFit = useTripStore((s) => s.requestFit);
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
      className={STRIP_POSITION}
    >
      <div className="no-scrollbar flex flex-nowrap items-center gap-1.5 overflow-x-auto px-3 py-0.5" role={role} aria-label={label}>
        <button
          type="button"
          onClick={requestFit}
          aria-label="Fit map to places"
          className="grid size-8 shrink-0 place-items-center rounded-full border border-zinc-700/60 bg-zinc-900/85 text-zinc-300 shadow-[0_6px_20px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md active:bg-zinc-800"
        >
          <Scan className="size-3.5" />
        </button>
        {children}
      </div>
    </motion.div>
  );
}

function StripChip({
  active,
  color,
  onClick,
  role = 'radio',
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  role?: 'radio' | 'button';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={role === 'radio' ? active : undefined}
      onClick={onClick}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap shadow-[0_6px_20px_-8px_rgba(0,0,0,0.7)] backdrop-blur-md transition-colors',
        active
          ? 'border-zinc-100 bg-zinc-100 text-zinc-900'
          : 'border-zinc-700/60 bg-zinc-900/85 text-zinc-200 active:bg-zinc-800',
      )}
    >
      {color && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </button>
  );
}

function MobileDayStrip({ days, savedCount }: { days: TripDay[]; savedCount: number }) {
  const dayFilter = useTripStore((s) => s.dayFilter);
  const setDayFilter = useTripStore((s) => s.setDayFilter);

  return (
    <MobileStrip label="Filter map by day">
      <StripChip active={dayFilter === 'all'} onClick={() => setDayFilter('all')}>
        All days
      </StripChip>
      {days.map((day) => (
        <StripChip key={day.date} active={dayFilter === day.date} color={day.color} onClick={() => setDayFilter(day.date)}>
          Day {day.index}
        </StripChip>
      ))}
      {savedCount > 0 && (
        <StripChip active={dayFilter === UNASSIGNED} color={UNASSIGNED_COLOR} onClick={() => setDayFilter(UNASSIGNED)}>
          Saved
        </StripChip>
      )}
    </MobileStrip>
  );
}

function MobileTripStrip({ trips, colors }: { trips: Project[]; colors: Map<string, string> }) {
  const setActiveProject = useTripStore((s) => s.setActiveProject);
  return (
    <MobileStrip label="Trips in this project" role="toolbar">
      {trips.map((trip) => (
        <StripChip key={trip.id} role="button" active={false} color={colors.get(trip.id)} onClick={() => setActiveProject(trip.id)}>
          {trip.title}
        </StripChip>
      ))}
    </MobileStrip>
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
