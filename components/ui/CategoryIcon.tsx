import { BedDouble, Landmark, MapPin, TrainFront, Utensils, type LucideIcon } from 'lucide-react';
import type { PinCategory } from '@/types/trip';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '@/lib/itinerary';
import { cn } from '@/lib/utils';

export const CATEGORY_ICONS: Record<PinCategory, LucideIcon> = {
  sightseeing: Landmark,
  food: Utensils,
  hotel: BedDouble,
  transit: TrainFront,
  other: MapPin,
};

export function CategoryIcon({ category, className }: { category: PinCategory; className?: string }) {
  const Icon = CATEGORY_ICONS[category];
  return <Icon className={cn('size-3.5', className)} style={{ color: CATEGORY_COLORS[category] }} aria-hidden />;
}

export function CategoryTag({ category, className }: { category: PinCategory; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-zinc-700/60 bg-zinc-900/60 px-1.5 py-0.5 text-[11px] font-medium text-zinc-300',
        className,
      )}
    >
      <CategoryIcon category={category} className="size-3" />
      {CATEGORY_LABELS[category]}
    </span>
  );
}
