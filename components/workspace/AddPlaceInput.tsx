'use client';

import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LoaderCircle, MapPinPlus, Plus, Search } from 'lucide-react';
import { UNASSIGNED, type BucketKey } from '@/types/trip';
import type { PlaceResult } from '@/lib/geocode';
import { usePlaceSearch } from '@/hooks/usePlaceSearch';
import { useTripStore } from '@/store/useTripStore';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { cn } from '@/lib/utils';

interface Props {
  bucket: BucketKey;
  /** Search bias when the map hasn't reported a center yet. */
  fallbackCenter: { lat: number; lng: number };
  accent?: string;
}

type Option = { kind: 'place'; place: PlaceResult } | { kind: 'custom'; name: string };

/** Inline "+ Add a place" search that adds straight into a day or Saved Places. */
export function AddPlaceInput({ bucket, fallbackCenter, accent = '#6366f1' }: Props) {
  const addPin = useTripStore((s) => s.addPin);
  const notify = useTripStore((s) => s.notify);
  const mapCenter = useTripStore((s) => s.mapCenter);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const center = mapCenter ?? fallbackCenter;

  const { results, status } = usePlaceSearch(query, { near: center, enabled: open });
  const trimmed = query.trim();
  const options: Option[] = [
    ...results.map((place): Option => ({ kind: 'place', place })),
    ...(trimmed.length >= 2 ? [{ kind: 'custom', name: trimmed } satisfies Option] : []),
  ];

  const dayDate = bucket === UNASSIGNED ? null : bucket;

  const pick = (option: Option) => {
    if (option.kind === 'place') {
      const { place } = option;
      void addPin({
        name: place.name,
        address: place.address || null,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
        day_date: dayDate,
      });
    } else {
      // Offline / no match: drop it near the current view; the marker is draggable.
      const jitter = () => (Math.random() - 0.5) * 0.004;
      void addPin({ name: option.name, lat: center.lat + jitter(), lng: center.lng + jitter(), day_date: dayDate });
      notify('Drag the new marker on the map to set its exact spot.');
    }
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setQuery('');
      setOpen(false);
      return;
    }
    if (options.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + options.length) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[Math.min(highlight, options.length - 1)];
      if (option) pick(option);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex w-full items-center gap-2 rounded-xl border border-dashed border-zinc-700/70 px-3 py-2.5 text-[13px] text-zinc-500 transition-colors hover:border-zinc-600 hover:bg-zinc-800/40 hover:text-zinc-200"
      >
        <Plus className="size-4 transition-colors" style={{ color: accent }} />
        Add a place
      </button>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2 ring-2 ring-indigo-500/15 transition-colors focus-within:border-indigo-500/60">
        {status === 'loading' ? (
          <LoaderCircle className="size-4 shrink-0 animate-spin text-zinc-500" />
        ) : (
          <Search className="size-4 shrink-0 text-zinc-500" />
        )}
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          onBlur={() =>
            window.setTimeout(() => {
              setOpen(false);
              setQuery('');
            }, 120)
          }
          placeholder="Search restaurants, sights, hotels…"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
        />
        <kbd className="hidden rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-500 sm:block">esc</kbd>
      </div>

      <AnimatePresence>
        {options.length > 0 && (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="mt-1.5 overflow-hidden rounded-xl border border-zinc-700/70 bg-zinc-900 p-1 shadow-2xl shadow-black/40"
          >
            {options.map((option, i) => (
              <li key={option.kind === 'place' ? option.place.id : 'custom'} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(option)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                    i === highlight ? 'bg-zinc-800' : 'hover:bg-zinc-800/60',
                  )}
                >
                  {option.kind === 'place' ? (
                    <>
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-zinc-800">
                        <CategoryIcon category={option.place.category} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-zinc-100">{option.place.name}</span>
                        <span className="block truncate text-[11px] text-zinc-500 capitalize">
                          {[option.place.kind, option.place.address].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-indigo-500/10">
                        <MapPinPlus className="size-3.5 text-indigo-300" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-zinc-300">
                        Add “<span className="text-zinc-100">{option.name}</span>” as a custom place
                      </span>
                    </>
                  )}
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      {status === 'error' && trimmed.length >= 2 && (
        <p className="mt-1.5 px-1 text-[11px] text-zinc-500">Search is offline — you can still add it as a custom place.</p>
      )}
    </div>
  );
}
