'use client';

import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { addDays } from 'date-fns';
import {
  CalendarDays,
  Check,
  Cloud,
  Compass,
  HardDrive,
  LoaderCircle,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { NewProjectInput, Project } from '@/types/trip';
import { useTripStore } from '@/store/useTripStore';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import type { PlaceResult } from '@/lib/geocode';
import { resetDemoData } from '@/lib/supabaseClient';
import { MAX_TRIP_DAYS, tripLength } from '@/lib/itinerary';
import { cn, formatDateRange, formatDateRangeLong, parseISODate, toISODate, todayISO } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Sidebar                                                                    */
/* -------------------------------------------------------------------------- */

export function PrimarySidebar() {
  const projects = useTripStore((s) => s.projects);
  const status = useTripStore((s) => s.projectsStatus);
  const activeProjectId = useTripStore((s) => s.activeProjectId);
  const setActiveProject = useTripStore((s) => s.setActiveProject);
  const deleteProject = useTripStore((s) => s.deleteProject);
  const [modalOpen, setModalOpen] = useState(false);
  const [filter, setFilter] = useState('');

  const { upcoming, past } = useMemo(() => {
    const today = todayISO();
    const q = filter.trim().toLowerCase();
    const visible = q
      ? projects.filter((p) => `${p.title} ${p.destination_name}`.toLowerCase().includes(q))
      : projects;
    return {
      upcoming: visible.filter((p) => p.end_date >= today).sort((a, b) => a.start_date.localeCompare(b.start_date)),
      past: visible.filter((p) => p.end_date < today).sort((a, b) => b.end_date.localeCompare(a.end_date)),
    };
  }, [projects, filter]);

  return (
    <aside className="relative z-30 flex h-full w-[260px] shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-[0_0_20px_-4px_rgba(99,102,241,0.7)]">
          <Compass className="size-[18px] text-white" strokeWidth={2.25} />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-tight">Wayfarer</p>
          <p className="text-[11px] text-zinc-500">Trip planner</p>
        </div>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-500 hover:shadow-[0_0_24px_-6px_rgba(99,102,241,0.85)] focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:outline-none active:scale-[0.98]"
        >
          <Plus className="size-4" strokeWidth={2.5} />
          New Trip
        </button>
      </div>

      <div className="px-3 pt-3">
        <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5 text-zinc-500 focus-within:border-zinc-700 focus-within:text-zinc-300">
          <Search className="size-3.5" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search trips"
            className="w-full bg-transparent text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
        </label>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-2 pt-4 pb-3" aria-label="Trips">
        {status === 'loading' && <TripListSkeleton />}
        {status === 'ready' && projects.length === 0 && (
          <div className="mx-2 rounded-xl border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
            No trips yet. Start one with <span className="text-zinc-300">New Trip</span>.
          </div>
        )}
        {status === 'ready' && filter && upcoming.length + past.length === 0 && (
          <p className="px-3 text-xs text-zinc-500">No trips match “{filter}”.</p>
        )}
        <TripGroup
          label="Upcoming Trips"
          projects={upcoming}
          activeId={activeProjectId}
          onSelect={setActiveProject}
          onDelete={deleteProject}
        />
        <TripGroup
          label="Past Trips"
          projects={past}
          activeId={activeProjectId}
          onSelect={setActiveProject}
          onDelete={deleteProject}
        />
      </nav>

      <SyncStatus />

      <NewTripModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </aside>
  );
}

function TripGroup({
  label,
  projects,
  activeId,
  onSelect,
  onDelete,
}: {
  label: string;
  projects: Project[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  if (projects.length === 0) return null;
  return (
    <section className="mb-5">
      <h3 className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{label}</h3>
      <ul className="space-y-0.5">
        {projects.map((project) => (
          <TripItem
            key={project.id}
            project={project}
            active={project.id === activeId}
            onSelect={() => onSelect(project.id)}
            onDelete={() => void onDelete(project.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function TripItem({
  project,
  active,
  onSelect,
  onDelete,
}: {
  project: Project;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const today = todayISO();
  const ongoing = project.start_date <= today && project.end_date >= today;

  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={`${project.destination_name} · ${formatDateRangeLong(project.start_date, project.end_date)}`}
        className={cn(
          'relative flex w-full flex-col gap-1 rounded-lg py-2 pr-9 pl-3 text-left transition-colors',
          active ? 'bg-zinc-800/80 text-zinc-50' : 'text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100',
        )}
      >
        {active && (
          <motion.span
            layoutId="active-trip-pill"
            className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.8)]"
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        )}
        <span className="truncate text-[13.5px] font-medium">{project.title}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn(
              'shrink-0 rounded-md px-1.5 py-px text-[10.5px] font-medium tabular-nums',
              active ? 'bg-indigo-500/15 text-indigo-300' : 'bg-zinc-800/80 text-zinc-400',
            )}
          >
            {formatDateRange(project.start_date, project.end_date)}
          </span>
          {ongoing && (
            <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400" /> Now
            </span>
          )}
          <span className="truncate text-[11px] text-zinc-500">{project.destination_name}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
        aria-label={confirming ? `Confirm delete ${project.title}` : `Delete ${project.title}`}
        className={cn(
          'absolute top-2 right-1.5 rounded-md p-1 transition-all',
          confirming
            ? 'bg-rose-500/15 text-rose-300 opacity-100'
            : 'text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700/60 hover:text-zinc-200 focus-visible:opacity-100',
        )}
      >
        {confirming ? <Check className="size-3.5" /> : <Trash2 className="size-3.5" />}
      </button>
    </li>
  );
}

function TripListSkeleton() {
  return (
    <div className="space-y-2 px-2" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-1.5 rounded-lg px-2 py-2">
          <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
          <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-900" />
        </div>
      ))}
    </div>
  );
}

function SyncStatus() {
  const mode = useTripStore((s) => s.mode);
  const pending = useTripStore((s) => s.pendingWrites);
  const saving = pending > 0;

  return (
    <div className="border-t border-zinc-800/80 p-3">
      <div className="flex items-center gap-2.5 rounded-lg bg-zinc-900/60 px-2.5 py-2">
        {mode === 'supabase' ? (
          <Cloud className="size-4 shrink-0 text-emerald-400" />
        ) : (
          <HardDrive className="size-4 shrink-0 text-amber-400" />
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-xs font-medium text-zinc-200">{mode === 'supabase' ? 'Supabase sync' : 'Demo mode'}</p>
          <p className="truncate text-[11px] text-zinc-500">
            {saving ? 'Saving changes…' : mode === 'supabase' ? 'All changes saved' : 'Saved in this browser'}
          </p>
        </div>
        {saving ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-zinc-400" />
        ) : mode === 'demo' ? (
          <button
            type="button"
            onClick={() => {
              resetDemoData();
              window.location.reload();
            }}
            title="Reset demo data"
            aria-label="Reset demo data"
            className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <RotateCcw className="size-3.5" />
          </button>
        ) : (
          <Check className="size-3.5 shrink-0 text-emerald-400" />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  New Trip modal                                                             */
/* -------------------------------------------------------------------------- */

interface Destination {
  name: string;
  lat: number;
  lng: number;
}

const PRESET_CITIES: Destination[] = [
  { name: 'Tokyo, Japan', lat: 35.6762, lng: 139.6503 },
  { name: 'Paris, France', lat: 48.8566, lng: 2.3522 },
  { name: 'New York, USA', lat: 40.7128, lng: -74.006 },
  { name: 'Lisbon, Portugal', lat: 38.7223, lng: -9.1393 },
  { name: 'Seoul, South Korea', lat: 37.5665, lng: 126.978 },
  { name: 'Barcelona, Spain', lat: 41.3874, lng: 2.1686 },
  { name: 'Mexico City, Mexico', lat: 19.4326, lng: -99.1332 },
  { name: 'Reykjavík, Iceland', lat: 64.1466, lng: -21.9426 },
  { name: 'Cape Town, South Africa', lat: -33.9249, lng: 18.4241 },
  { name: 'Bali, Indonesia', lat: -8.4095, lng: 115.1889 },
];

/** `Kyoto, Japan` from a Photon city result. */
function destinationLabel(place: PlaceResult): string {
  const country = place.address.split(', ').pop();
  return country && country !== place.name ? `${place.name}, ${country}` : place.name;
}

function defaultDates(): { start: string; end: string } {
  const start = addDays(new Date(), 14);
  return { start: toISODate(start), end: toISODate(addDays(start, 4)) };
}

function NewTripModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="new-trip"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-trip-title"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            className="relative w-full max-w-[460px] rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60"
          >
            <NewTripForm onClose={onClose} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function NewTripForm({ onClose }: { onClose: () => void }) {
  const createProject = useTripStore((s) => s.createProject);
  const [initialDates] = useState(defaultDates);
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [destination, setDestination] = useState<Destination | null>(null);
  const [startDate, setStartDate] = useState(initialDates.start);
  const [endDate, setEndDate] = useState(initialDates.end);
  const [showResults, setShowResults] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const listId = useId();

  const { results, status } = usePlaceSearch(query, { citiesOnly: true, enabled: showResults && destination === null });

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const length = tripLength(startDate, endDate);
  const errors = {
    title: title.trim() ? null : 'Give your trip a name',
    destination: destination ? null : 'Pick a destination from the list',
    dates:
      !parseISODate(startDate) || !parseISODate(endDate)
        ? 'Choose both dates'
        : length < 1
          ? 'End date must be on or after the start date'
          : length > MAX_TRIP_DAYS
            ? `Trips can be up to ${MAX_TRIP_DAYS} days`
            : null,
  };
  const valid = !errors.title && !errors.destination && !errors.dates;

  const choose = (place: Destination) => {
    setDestination(place);
    setQuery(place.name);
    setShowResults(false);
    setTitle((current) => current || `Trip to ${place.name.split(',')[0]}`);
  };

  const onDestinationKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showResults || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      const pick = results[highlight];
      if (pick) {
        e.preventDefault();
        choose({ name: destinationLabel(pick), lat: pick.lat, lng: pick.lng });
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (!valid || !destination || submitting) return;
    setSubmitting(true);
    const input: NewProjectInput = {
      title: title.trim(),
      destination_name: destination.name,
      center_lat: destination.lat,
      center_lng: destination.lng,
      start_date: startDate,
      end_date: endDate,
    };
    onClose();
    await createProject(input);
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex items-start justify-between border-b border-zinc-800 px-5 pt-5 pb-4">
        <div>
          <h2 id="new-trip-title" className="text-base font-semibold tracking-tight">
            Plan a new trip
          </h2>
          <p className="mt-0.5 text-[13px] text-zinc-500">Days are generated from your dates automatically.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
        <Field label="Trip title" error={attempted ? errors.title : null}>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Autumn in Kyoto"
            maxLength={80}
            className={inputClass}
          />
        </Field>

        <Field label="Destination" error={attempted ? errors.destination : null}>
          <div className="relative">
            <MapPin className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setDestination(null);
                setShowResults(true);
                setHighlight(0);
              }}
              onFocus={() => setShowResults(true)}
              onBlur={() => window.setTimeout(() => setShowResults(false), 120)}
              onKeyDown={onDestinationKey}
              placeholder="Search a city…"
              role="combobox"
              aria-expanded={showResults && results.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              className={cn(inputClass, 'pl-9', destination && 'pr-24')}
            />
            {destination && (
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                {destination.lat.toFixed(2)}, {destination.lng.toFixed(2)}
              </span>
            )}
            {status === 'loading' && !destination && (
              <LoaderCircle className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-zinc-500" />
            )}
            <AnimatePresence>
              {showResults && !destination && (results.length > 0 || status === 'error') && (
                <motion.ul
                  id={listId}
                  role="listbox"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute inset-x-0 top-full z-10 mt-1.5 overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 p-1 shadow-2xl"
                >
                  {status === 'error' && (
                    <li className="px-3 py-2 text-xs text-zinc-500">Search is unavailable — pick a preset below.</li>
                  )}
                  {results.map((place, i) => {
                    const label = destinationLabel(place);
                    return (
                      <li key={place.id} role="option" aria-selected={i === highlight}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setHighlight(i)}
                          onClick={() => choose({ name: label, lat: place.lat, lng: place.lng })}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                            i === highlight ? 'bg-zinc-800' : 'hover:bg-zinc-800/60',
                          )}
                        >
                          <MapPin className="size-3.5 shrink-0 text-indigo-400" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-zinc-100">{place.name}</span>
                            <span className="block truncate text-[11px] text-zinc-500">{place.address || place.kind}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
          <div className="scrollbar-none -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {PRESET_CITIES.map((city) => {
              const selected = destination?.name === city.name;
              return (
                <button
                  key={city.name}
                  type="button"
                  onClick={() => choose(city)}
                  className={cn(
                    'shrink-0 rounded-full border px-2.5 py-1 text-xs transition-colors',
                    selected
                      ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200'
                      : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
                  )}
                >
                  {city.name.split(',')[0]}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const next = e.target.value;
                setStartDate(next);
                // Keep the range valid when the start jumps past the end.
                if (next && endDate && next > endDate) setEndDate(next);
              }}
              className={cn(inputClass, '[color-scheme:dark]')}
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={cn(inputClass, '[color-scheme:dark]')}
            />
          </Field>
        </div>

        <div
          className={cn(
            'flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px]',
            errors.dates && attempted
              ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
              : 'border-zinc-800 bg-zinc-950/40 text-zinc-400',
          )}
        >
          <CalendarDays className="size-4 shrink-0" />
          {errors.dates ? (
            <span>{errors.dates}</span>
          ) : (
            <span>
              <span className="font-medium text-zinc-200">
                {length} day{length === 1 ? '' : 's'}
              </span>{' '}
              · {formatDateRangeLong(startDate, endDate)}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3.5">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className={cn(
            'flex items-center gap-2 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition-all hover:bg-indigo-500 disabled:opacity-60',
            !valid && 'opacity-70',
          )}
        >
          {submitting && <LoaderCircle className="size-4 animate-spin" />}
          Create trip
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-indigo-500/70 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none';

function Field({ label, error, children }: { label: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
      {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
