'use client';

import { forwardRef, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Bookmark, CalendarDays, Check, GripVertical, Pencil, Trash2, X } from 'lucide-react';
import { PIN_CATEGORIES, UNASSIGNED, type PinCategory, type ProjectPin, type TripDay } from '@/types/trip';
import { CATEGORY_LABELS, type PinDisplayMeta } from '@/lib/itinerary';
import { useTripStore } from '@/store/useTripStore';
import { CategoryIcon, CategoryTag } from '@/components/ui/CategoryIcon';
import { cn, formatCurrency, roundMoney } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/*  Badge                                                                      */
/* -------------------------------------------------------------------------- */

export function PinBadge({ meta, className }: { meta: PinDisplayMeta; className?: string }) {
  return (
    <span
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold text-white tabular-nums ring-2 ring-zinc-900',
        className,
      )}
      style={{ backgroundColor: meta.color, boxShadow: `0 0 14px -4px ${meta.color}` }}
    >
      {meta.number ?? <Bookmark className="size-3.5" strokeWidth={2.5} />}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Card                                                                       */
/* -------------------------------------------------------------------------- */

interface PinCardProps extends HTMLAttributes<HTMLDivElement> {
  pin: ProjectPin;
  meta: PinDisplayMeta;
  days: TripDay[];
  dragging?: boolean;
  overlay?: boolean;
  editing?: boolean;
  onEditChange?: (editing: boolean) => void;
}

export const PinCard = forwardRef<HTMLDivElement, PinCardProps>(function PinCard(
  { pin, meta, days, dragging = false, overlay = false, editing = false, onEditChange, className, ...rest },
  ref,
) {
  const hovered = useTripStore((s) => s.hoveredPinId === pin.id);
  const selected = useTripStore((s) => s.selectedPinId === pin.id);
  const setHoveredPin = useTripStore((s) => s.setHoveredPin);
  const selectPin = useTripStore((s) => s.selectPin);
  const deletePin = useTripStore((s) => s.deletePin);
  const movePinToBucket = useTripStore((s) => s.movePinToBucket);
  const innerRef = useRef<HTMLDivElement | null>(null);

  // Marker clicks select a card that may be off-screen.
  useEffect(() => {
    if (selected && !overlay) innerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected, overlay]);

  const setRefs = (node: HTMLDivElement | null) => {
    innerRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  if (editing) {
    return (
      <div ref={setRefs} className={cn('rounded-xl border border-indigo-500/40 bg-zinc-800 p-3.5', className)}>
        <PinEditor pin={pin} onDone={() => onEditChange?.(false)} />
      </div>
    );
  }

  const bucket = meta.bucket;

  return (
    <div
      ref={setRefs}
      {...rest}
      data-pin-id={pin.id}
      onMouseEnter={() => setHoveredPin(pin.id)}
      onMouseLeave={() => setHoveredPin(null)}
      onClick={() => selectPin(pin.id, { fly: true })}
      className={cn(
        'group relative flex cursor-pointer gap-3 rounded-xl border p-3.5 transition-all outline-none select-none',
        'border-zinc-700/50 bg-zinc-800/60 hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-indigo-500/60',
        (hovered || selected) && 'bg-zinc-800',
        hovered && 'border-zinc-600',
        selected && 'border-indigo-500/60 ring-1 ring-indigo-500/30',
        dragging && 'opacity-30',
        overlay && 'cursor-grabbing border-zinc-600 bg-zinc-800 shadow-2xl ring-1 shadow-black/50 ring-indigo-500/40',
        className,
      )}
    >
      <GripVertical
        className="absolute top-1/2 -left-0.5 size-3.5 -translate-y-1/2 text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden
      />
      <PinBadge meta={meta} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm leading-7 font-medium text-zinc-100">{pin.name}</p>
          {pin.cost > 0 && (
            <span className="mt-1 shrink-0 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 tabular-nums">
              {formatCurrency(pin.cost, true)}
            </span>
          )}
        </div>
        {pin.address && <p className="-mt-0.5 truncate text-xs text-zinc-500">{pin.address}</p>}
        {pin.notes && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-400">{pin.notes}</p>}

        <div className="mt-2.5 flex items-center gap-1.5">
          <CategoryTag category={pin.category} />
          <div
            className={cn(
              'ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
              (selected || overlay) && 'opacity-100',
            )}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <label
              title="Move to day"
              className="relative grid size-7 cursor-pointer place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100"
            >
              <CalendarDays className="size-3.5" />
              <span className="sr-only">Move to day</span>
              <select
                value={bucket}
                onChange={(e) => void movePinToBucket(pin.id, e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value={UNASSIGNED}>Saved Places</option>
                {days.map((day) => (
                  <option key={day.date} value={day.date}>
                    Day {day.index} · {day.label}
                  </option>
                ))}
              </select>
            </label>
            <IconButton label="Edit place" onClick={() => onEditChange?.(true)}>
              <Pencil className="size-3.5" />
            </IconButton>
            <IconButton label="Delete place" danger onClick={() => void deletePin(pin.id)}>
              <Trash2 className="size-3.5" />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
});

function IconButton({
  label,
  danger = false,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'grid size-7 place-items-center rounded-lg text-zinc-400 transition-colors',
        danger ? 'hover:bg-rose-500/15 hover:text-rose-300' : 'hover:bg-zinc-700/60 hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline editor                                                              */
/* -------------------------------------------------------------------------- */

function PinEditor({ pin, onDone }: { pin: ProjectPin; onDone: () => void }) {
  const updatePin = useTripStore((s) => s.updatePin);
  const [name, setName] = useState(pin.name);
  const [category, setCategory] = useState<PinCategory>(pin.category);
  const [cost, setCost] = useState(pin.cost ? String(pin.cost) : '');
  const [notes, setNotes] = useState(pin.notes ?? '');
  const [address, setAddress] = useState(pin.address ?? '');

  const save = () => {
    const parsedCost = Number.parseFloat(cost);
    void updatePin(pin.id, {
      name: name.trim() || pin.name,
      category,
      cost: Number.isFinite(parsedCost) && parsedCost > 0 ? roundMoney(parsedCost) : 0,
      notes: notes.trim() || null,
      address: address.trim() || null,
    });
    onDone();
  };

  const field =
    'w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-indigo-500/60 focus:outline-none';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
      }}
      className="space-y-2.5"
    >
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Place name" className={field} />
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Address" className={cn(field, 'text-xs')} />
      <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Category">
        {PIN_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={category === c}
            onClick={() => setCategory(c)}
            className={cn(
              'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
              category === c
                ? 'border-indigo-500/60 bg-indigo-500/15 text-zinc-100'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200',
            )}
          >
            <CategoryIcon category={c} className="size-3" />
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-zinc-500">$</span>
        <input
          inputMode="decimal"
          value={cost}
          onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="0.00"
          className={cn(field, 'pl-6 tabular-nums')}
          aria-label="Cost"
        />
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes — opening hours, booking refs, tips…"
        rows={2}
        className={cn(field, 'resize-none text-xs leading-relaxed')}
      />
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onDone}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-100"
        >
          <X className="size-3.5" /> Cancel
        </button>
        <button
          type="submit"
          className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
        >
          <Check className="size-3.5" /> Save
        </button>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sortable wrapper                                                           */
/* -------------------------------------------------------------------------- */

export function SortablePinCard({ pin, meta, days }: { pin: ProjectPin; meta: PinDisplayMeta; days: TripDay[] }) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pin.id,
    disabled: editing,
  });
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };

  return (
    <PinCard
      ref={setNodeRef}
      style={style}
      pin={pin}
      meta={meta}
      days={days}
      dragging={isDragging}
      editing={editing}
      onEditChange={setEditing}
      {...attributes}
      {...listeners}
    />
  );
}
