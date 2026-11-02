'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bookmark,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Crosshair,
  ListOrdered,
  Map as MapIcon,
  MapPin,
  Pencil,
  Wallet,
  X,
} from 'lucide-react';
import { UNASSIGNED, type BucketKey, type Project, type ProjectPin, type TripDay } from '@/types/trip';
import { MAX_TRIP_DAYS, sumCost, tripLength, UNASSIGNED_COLOR } from '@/lib/itinerary';
import { useItinerary } from '@/hooks/useItinerary';
import { useTripStore, type WorkspaceTab } from '@/store/useTripStore';
import { AddPlaceInput } from '@/components/workspace/AddPlaceInput';
import { BudgetPanel } from '@/components/workspace/BudgetPanel';
import { BucketDropZone, PinBoard } from '@/components/workspace/PinBoard';
import { SidebarToggle } from '@/components/PrimarySidebar';
import { cn, formatCurrency, formatDateRange, parseISODate } from '@/lib/utils';

const DRAWER_WIDTH = 420;
const drawerSpring = { type: 'spring', stiffness: 340, damping: 38, mass: 0.9 } as const;

/* -------------------------------------------------------------------------- */
/*  Drawer shell                                                               */
/* -------------------------------------------------------------------------- */

/**
 * From 768px up the drawer pushes the map aside. On phones it becomes a full-screen
 * sheet that trades places with the map via a floating toggle.
 */
export function SecondarySidebar() {
  const activeProjectId = useTripStore((s) => s.activeProjectId);
  const mobile = useTripStore((s) => s.viewport === 'mobile');
  const mobilePanel = useTripStore((s) => s.mobilePanel);
  // Keep rendering the last trip while the drawer animates closed.
  const [shownId, setShownId] = useState<string | null>(activeProjectId);
  if (activeProjectId !== null && activeProjectId !== shownId) setShownId(activeProjectId);

  if (mobile) {
    return (
      <>
        <AnimatePresence initial={false} onExitComplete={() => setShownId(null)}>
          {activeProjectId && mobilePanel === 'workspace' && (
            <motion.aside
              key="workspace-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={drawerSpring}
              className="absolute inset-0 z-20 overflow-hidden bg-zinc-900"
              aria-label="Trip workspace"
            >
              {shownId && <Workspace projectId={shownId} fluid />}
            </motion.aside>
          )}
        </AnimatePresence>
        {activeProjectId && <MobilePanelToggle />}
      </>
    );
  }

  return (
    <AnimatePresence initial={false} onExitComplete={() => setShownId(null)}>
      {activeProjectId && (
        <motion.aside
          key="workspace"
          initial={{ width: 0 }}
          animate={{ width: DRAWER_WIDTH }}
          exit={{ width: 0 }}
          transition={drawerSpring}
          className="relative z-20 h-full shrink-0 overflow-hidden border-r border-zinc-800 bg-zinc-900/95 backdrop-blur-md max-md:hidden"
          aria-label="Trip workspace"
        >
          {shownId && <Workspace projectId={shownId} />}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function MobilePanelToggle() {
  const mobilePanel = useTripStore((s) => s.mobilePanel);
  const setMobilePanel = useTripStore((s) => s.setMobilePanel);
  const showingMap = mobilePanel === 'map';

  return (
    <button
      type="button"
      onClick={() => setMobilePanel(showingMap ? 'workspace' : 'map')}
      className="fixed bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-100 px-4 py-2.5 text-sm font-medium text-zinc-900 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] transition-transform active:scale-95"
    >
      {showingMap ? <ListOrdered className="size-4" /> : <MapIcon className="size-4" />}
      {showingMap ? 'Itinerary' : 'Map'}
    </button>
  );
}

function Workspace({ projectId, fluid = false }: { projectId: string; fluid?: boolean }) {
  const { project, pins, days, buckets } = useItinerary(projectId);
  const activeTab = useTripStore((s) => s.activeTab);
  const pinsStatus = useTripStore((s) => s.pinsStatus[projectId] ?? 'idle');
  const pinsById = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [projectId, activeTab]);

  if (!project) return null;
  const loading = pinsStatus === 'loading' || pinsStatus === 'idle';

  return (
    <div className="flex h-full flex-col" style={{ width: fluid ? '100%' : DRAWER_WIDTH }}>
      <WorkspaceHeader project={project} pins={pins} savedCount={(buckets.get(UNASSIGNED) ?? []).length} />
      <div ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto px-4 pt-4 pb-28">
        {loading ? (
          <PanelSkeleton />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${projectId}:${activeTab}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
            >
              {activeTab === 'itinerary' && (
                <ItineraryPanel project={project} days={days} buckets={buckets} pinsById={pinsById} />
              )}
              {activeTab === 'saved' && (
                <SavedPanel project={project} days={days} buckets={buckets} pinsById={pinsById} />
              )}
              {activeTab === 'budget' && <BudgetPanel pins={pins} days={days} buckets={buckets} />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Header                                                                     */
/* -------------------------------------------------------------------------- */

function WorkspaceHeader({ project, pins, savedCount }: { project: Project; pins: ProjectPin[]; savedCount: number }) {
  const setActiveProject = useTripStore((s) => s.setActiveProject);
  const total = sumCost(pins);

  return (
    <header className="relative z-10 shrink-0 border-b border-zinc-800 bg-zinc-900/95 px-4 pt-4 backdrop-blur-md sm:px-5">
      <div className="flex items-start gap-3">
        <SidebarToggle className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs text-zinc-500">
            <MapPin className="size-3.5" />
            <span className="truncate">{project.destination_name}</span>
          </p>
          <EditableTitle project={project} />
        </div>
        <button
          type="button"
          onClick={() => setActiveProject(null)}
          className="-mr-1.5 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close trip"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <DateRangePill project={project} />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 tabular-nums">
          <Wallet className="size-3.5" />
          {formatCurrency(total)}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1 text-xs text-zinc-400 tabular-nums">
          <MapPin className="size-3.5" />
          {pins.length} place{pins.length === 1 ? '' : 's'}
        </span>
      </div>

      <WorkspaceTabs savedCount={savedCount} />
    </header>
  );
}

function EditableTitle({ project }: { project: Project }) {
  const updateProject = useTripStore((s) => s.updateProject);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.title);

  const commit = () => {
    setEditing(false);
    const next = value.trim();
    if (next && next !== project.title) void updateProject(project.id, { title: next });
    else setValue(project.title);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={80}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setValue(project.title);
            setEditing(false);
          }
        }}
        className="mt-0.5 -ml-1 w-full rounded-md border border-indigo-500/50 bg-zinc-950/60 px-1 text-lg font-semibold tracking-tight text-zinc-50 focus:outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setValue(project.title);
        setEditing(true);
      }}
      className="group mt-0.5 flex max-w-full items-center gap-2 text-left"
      title="Rename trip"
    >
      <h2 className="truncate text-lg font-semibold tracking-tight text-zinc-50">{project.title}</h2>
      <Pencil className="size-3.5 shrink-0 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

function DateRangePill({ project }: { project: Project }) {
  const updateProject = useTripStore((s) => s.updateProject);
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(project.start_date);
  const [end, setEnd] = useState(project.end_date);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const length = tripLength(start, end);
  const invalid = !parseISODate(start) || !parseISODate(end) || length < 1 || length > MAX_TRIP_DAYS;
  const days = tripLength(project.start_date, project.end_date);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          setStart(project.start_date);
          setEnd(project.end_date);
          setOpen((o) => !o);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors tabular-nums',
          open
            ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
            : 'border-zinc-700/60 bg-zinc-800/60 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800',
        )}
        aria-expanded={open}
      >
        <CalendarDays className="size-3.5 text-indigo-400" />
        {formatDateRange(project.start_date, project.end_date)}
        <span className="text-zinc-500">· {days}d</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute top-full left-0 z-30 mt-2 w-[300px] rounded-xl border border-zinc-700/70 bg-zinc-900 p-3 shadow-2xl shadow-black/50"
          >
            <p className="mb-2.5 text-xs font-medium text-zinc-400">Trip dates</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (e.target.value > end) setEnd(e.target.value);
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-xs text-zinc-100 [color-scheme:dark] focus:border-indigo-500/60 focus:outline-none"
                aria-label="Start date"
              />
              <input
                type="date"
                value={end}
                min={start}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950/60 px-2 py-1.5 text-xs text-zinc-100 [color-scheme:dark] focus:border-indigo-500/60 focus:outline-none"
                aria-label="End date"
              />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {invalid
                ? `Pick a range of 1–${MAX_TRIP_DAYS} days.`
                : `${length} day${length === 1 ? '' : 's'}. Places on removed days move to Saved Places.`}
            </p>
            <div className="mt-3 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={invalid}
                onClick={() => {
                  setOpen(false);
                  if (start !== project.start_date || end !== project.end_date) {
                    void updateProject(project.id, { start_date: start, end_date: end });
                  }
                }}
                className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const TABS: { id: WorkspaceTab; label: string }[] = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'saved', label: 'Saved Places' },
  { id: 'budget', label: 'Budget' },
];

function WorkspaceTabs({ savedCount }: { savedCount: number }) {
  const activeTab = useTripStore((s) => s.activeTab);
  const setActiveTab = useTripStore((s) => s.setActiveTab);

  return (
    <div role="tablist" aria-label="Workspace sections" className="my-3 grid grid-cols-3 rounded-xl bg-zinc-950/70 p-1">
      {TABS.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'relative rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'text-zinc-50' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            {active && (
              <motion.span
                layoutId="workspace-tab"
                className="absolute inset-0 rounded-lg border border-zinc-700/60 bg-zinc-800 shadow-sm"
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
              />
            )}
            <span className="relative flex items-center justify-center gap-1.5">
              {tab.label}
              {tab.id === 'saved' && savedCount > 0 && (
                <span className="rounded-full bg-zinc-700/80 px-1.5 text-[10px] text-zinc-300 tabular-nums">{savedCount}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Itinerary                                                                  */
/* -------------------------------------------------------------------------- */

interface PanelProps {
  project: Project;
  days: TripDay[];
  buckets: Map<BucketKey, ProjectPin[]>;
  pinsById: Map<string, ProjectPin>;
}

function ItineraryPanel({ project, days, buckets, pinsById }: PanelProps) {
  const setActiveTab = useTripStore((s) => s.setActiveTab);
  const bucketKeys = useMemo(() => days.map((d) => d.date), [days]);
  const savedCount = (buckets.get(UNASSIGNED) ?? []).length;
  const center = { lat: project.center_lat, lng: project.center_lng };

  if (days.length === 0) {
    return <p className="text-sm text-zinc-500">This trip has no valid dates. Edit the date range above.</p>;
  }

  return (
    <div className="space-y-3">
      <PinBoard bucketKeys={bucketKeys} buckets={buckets} pinsById={pinsById} days={days}>
        {(bucket, ids, list) => {
          const day = days.find((d) => d.date === bucket);
          if (!day) return null;
          const dayPins = ids.map((id) => pinsById.get(id)).filter((p): p is ProjectPin => p !== undefined);
          return (
            <DaySection key={day.date} day={day} pins={dayPins} center={center}>
              {list}
            </DaySection>
          );
        }}
      </PinBoard>

      {savedCount > 0 && (
        <button
          type="button"
          onClick={() => setActiveTab('saved')}
          className="flex w-full items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-3 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
        >
          <span className="grid size-7 place-items-center rounded-full" style={{ backgroundColor: `${UNASSIGNED_COLOR}33` }}>
            <Bookmark className="size-3.5 text-slate-300" />
          </span>
          <span className="flex-1 text-[13px] text-zinc-300">
            {savedCount} saved place{savedCount === 1 ? '' : 's'} waiting to be scheduled
          </span>
          <ChevronRight className="size-4 text-zinc-500" />
        </button>
      )}
    </div>
  );
}

function DaySection({
  day,
  pins,
  center,
  children,
}: {
  day: TripDay;
  pins: ProjectPin[];
  center: { lat: number; lng: number };
  children: React.ReactNode;
}) {
  const collapsed = useTripStore((s) => Boolean(s.collapsedBuckets[day.date]));
  const toggleBucket = useTripStore((s) => s.toggleBucket);
  const dayFilter = useTripStore((s) => s.dayFilter);
  const setDayFilter = useTripStore((s) => s.setDayFilter);
  const focused = dayFilter === day.date;
  const cost = sumCost(pins);

  return (
    <BucketDropZone
      bucket={day.date}
      className="rounded-2xl border border-transparent transition-colors"
      activeClassName="border-indigo-500/30 bg-indigo-500/[0.04]"
    >
      <div className="group/day flex items-center gap-1">
        <button
          type="button"
          onClick={() => toggleBucket(day.date)}
          aria-expanded={!collapsed}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-zinc-800/40"
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: day.color, boxShadow: `0 0 10px ${day.color}` }} />
          <span className="text-sm font-semibold text-zinc-100">Day {day.index}</span>
          <span className="truncate text-xs text-zinc-500">{day.label}</span>
          <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-zinc-500 tabular-nums">
            {pins.length > 0 && <span>{pins.length} stop{pins.length === 1 ? '' : 's'}</span>}
            {cost > 0 && <span className="text-zinc-400">{formatCurrency(cost)}</span>}
          </span>
          <ChevronDown className={cn('size-4 shrink-0 text-zinc-500 transition-transform', collapsed && '-rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => setDayFilter(focused ? 'all' : day.date)}
          title={focused ? 'Show all days on map' : `Show only Day ${day.index} on map`}
          aria-pressed={focused}
          className={cn(
            'rounded-lg p-1.5 transition-all',
            focused
              ? 'bg-indigo-500/15 text-indigo-300'
              : 'text-zinc-600 opacity-0 group-hover/day:opacity-100 hover:bg-zinc-800 hover:text-zinc-200 focus-visible:opacity-100',
          )}
        >
          <Crosshair className="size-3.5" />
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-1 pt-1 pb-3">
              {pins.length === 0 && (
                <p className="px-2 pb-1 text-xs text-zinc-600">Nothing planned yet — add a place or drag one here.</p>
              )}
              {children}
              <AddPlaceInput bucket={day.date} fallbackCenter={center} accent={day.color} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </BucketDropZone>
  );
}

/* -------------------------------------------------------------------------- */
/*  Saved Places                                                               */
/* -------------------------------------------------------------------------- */

const SAVED_KEYS: BucketKey[] = [UNASSIGNED];

function SavedPanel({ project, days, buckets, pinsById }: PanelProps) {
  const saved = buckets.get(UNASSIGNED) ?? [];
  const center = { lat: project.center_lat, lng: project.center_lng };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-3.5 py-3">
        <Bookmark className="mt-0.5 size-4 shrink-0 text-slate-400" />
        <p className="text-xs leading-relaxed text-zinc-400">
          Places you want to fit in somewhere. Use the <CalendarDays className="inline size-3.5 align-[-2px]" /> button on a
          card to schedule it, or click the map to drop a new pin.
        </p>
      </div>

      <AddPlaceInput bucket={UNASSIGNED} fallbackCenter={center} accent={UNASSIGNED_COLOR} />

      <PinBoard bucketKeys={SAVED_KEYS} buckets={buckets} pinsById={pinsById} days={days}>
        {(bucket, _ids, list) => (
          <BucketDropZone key={bucket} bucket={bucket}>
            {list}
          </BucketDropZone>
        )}
      </PinBoard>

      {saved.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-800 px-6 py-8 text-center">
          <p className="text-sm font-medium text-zinc-300">No saved places</p>
          <p className="mt-1 text-xs text-zinc-500">Search above or click anywhere on the map to start a wishlist.</p>
        </div>
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
          <div className="h-[84px] animate-pulse rounded-xl bg-zinc-800/50" />
          <div className="h-[84px] animate-pulse rounded-xl bg-zinc-800/30" />
        </div>
      ))}
    </div>
  );
}
