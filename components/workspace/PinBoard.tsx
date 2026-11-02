'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { BucketKey, ProjectPin, TripDay } from '@/types/trip';
import { UNASSIGNED_COLOR, type PinDisplayMeta } from '@/lib/itinerary';
import { useTripStore } from '@/store/useTripStore';
import { PinCard, SortablePinCard } from '@/components/workspace/PinCard';
import { cn } from '@/lib/utils';

type Arrangement = Record<BucketKey, string[]>;

const CONTAINER_PREFIX = 'bucket:';
const containerId = (bucket: BucketKey) => `${CONTAINER_PREFIX}${bucket}`;
const isContainerId = (id: UniqueIdentifier) => String(id).startsWith(CONTAINER_PREFIX);

interface PinBoardProps {
  bucketKeys: BucketKey[];
  buckets: Map<BucketKey, ProjectPin[]>;
  pinsById: Map<string, ProjectPin>;
  days: TripDay[];
  /** Render each bucket; place `list` where its cards should appear. */
  children: (bucket: BucketKey, ids: string[], list: ReactNode) => ReactNode;
}

/**
 * Multi-container sortable board. While dragging, cross-bucket moves live in local
 * state; the final arrangement is committed to the store (optimistic + persisted) on drop.
 */
export function PinBoard({ bucketKeys, buckets, pinsById, days, children }: PinBoardProps) {
  const applyArrangement = useTripStore((s) => s.applyArrangement);
  const toggleBucket = useTripStore((s) => s.toggleBucket);
  const collapsed = useTripStore((s) => s.collapsedBuckets);
  const setHoveredPin = useTripStore((s) => s.setHoveredPin);

  const base = useMemo<Arrangement>(
    () => Object.fromEntries(bucketKeys.map((key) => [key, (buckets.get(key) ?? []).map((pin) => pin.id)])),
    [bucketKeys, buckets],
  );
  const [dragItems, setDragItems] = useState<Arrangement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const items = dragItems ?? base;
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findBucket = useCallback((id: UniqueIdentifier): BucketKey | undefined => {
    const key = String(id);
    if (isContainerId(key)) return key.slice(CONTAINER_PREFIX.length);
    return Object.keys(itemsRef.current).find((bucket) => itemsRef.current[bucket]?.includes(key));
  }, []);

  /** Prefer cards under the pointer; over a bucket's empty space, snap to its closest card. */
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const hits = pointerWithin(args);
    const card = hits.find((hit) => !isContainerId(hit.id));
    if (card) return [card];
    const container = hits.find((hit) => isContainerId(hit.id));
    if (container) {
      const ids = itemsRef.current[String(container.id).slice(CONTAINER_PREFIX.length)] ?? [];
      const inside = args.droppableContainers.filter((c) => ids.includes(String(c.id)));
      const closest = inside.length > 0 ? closestCenter({ ...args, droppableContainers: inside }) : [];
      return closest.length > 0 ? closest : [container];
    }
    return closestCenter(args);
  }, []);

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDragItems(itemsRef.current);
    setHoveredPin(null);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = findBucket(active.id);
    const to = findBucket(over.id);
    if (!from || !to || from === to) return;
    if (collapsed[to]) toggleBucket(to, false);

    setDragItems((previous) => {
      const current = previous ?? itemsRef.current;
      const source = current[from] ?? [];
      const target = current[to] ?? [];
      const activeKey = String(active.id);
      let index = target.length;
      if (!isContainerId(over.id)) {
        const overIndex = target.indexOf(String(over.id));
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      const next: Arrangement = {
        ...current,
        [from]: source.filter((id) => id !== activeKey),
        [to]: [...target.slice(0, index).filter((id) => id !== activeKey), activeKey, ...target.slice(index).filter((id) => id !== activeKey)],
      };
      itemsRef.current = next;
      return next;
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    let final = itemsRef.current;
    if (over) {
      const from = findBucket(active.id);
      const to = findBucket(over.id);
      if (from && to && from === to) {
        const list = final[from] ?? [];
        const oldIndex = list.indexOf(String(active.id));
        const newIndex = isContainerId(over.id) ? list.length - 1 : list.indexOf(String(over.id));
        if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
          final = { ...final, [from]: arrayMove(list, oldIndex, newIndex) };
        }
      }
      void applyArrangement(final);
    }
    setDragItems(null);
    setActiveId(null);
  };

  const onDragCancel = () => {
    setDragItems(null);
    setActiveId(null);
  };

  const activePin = activeId ? pinsById.get(activeId) : undefined;
  const activeBucket = activeId ? findBucket(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      {bucketKeys.map((bucket) => {
        const ids = items[bucket] ?? [];
        const list = (
          <SortableContext key={bucket} items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {ids.map((id, index) => {
                const pin = pinsById.get(id);
                return pin ? <SortablePinCard key={id} pin={pin} meta={metaAt(bucket, index, days)} days={days} /> : null;
              })}
            </div>
          </SortableContext>
        );
        return children(bucket, ids, list);
      })}
      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
            {activePin && activeBucket ? (
              <PinCard
                pin={activePin}
                meta={metaAt(activeBucket, (items[activeBucket] ?? []).indexOf(activePin.id), days)}
                days={days}
                overlay
                className="w-[388px] rotate-[1.5deg]"
              />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  );
}

/** Badge number/color from the live (possibly mid-drag) position, so badges renumber as you drag. */
function metaAt(bucket: BucketKey, index: number, days: TripDay[]): PinDisplayMeta {
  const day = days.find((d) => d.date === bucket);
  if (!day) return { number: null, color: UNASSIGNED_COLOR, bucket, dayIndex: null };
  return { number: index + 1, color: day.color, bucket, dayIndex: day.index };
}

/** Drop target wrapper so empty / collapsed buckets still accept cards. */
export function BucketDropZone({
  bucket,
  className,
  activeClassName,
  children,
}: {
  bucket: BucketKey;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: containerId(bucket) });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && activeClassName)}>
      {children}
    </div>
  );
}
