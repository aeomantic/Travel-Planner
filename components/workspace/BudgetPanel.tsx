'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Bookmark, PiggyBank } from 'lucide-react';
import { PIN_CATEGORIES, UNASSIGNED, type BucketKey, type ProjectPin, type TripDay } from '@/types/trip';
import { CATEGORY_COLORS, CATEGORY_LABELS, sumCost, UNASSIGNED_COLOR } from '@/lib/itinerary';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { formatCurrency } from '@/lib/utils';
import { useTripStore } from '@/store/useTripStore';

interface Props {
  pins: ProjectPin[];
  days: TripDay[];
  buckets: Map<BucketKey, ProjectPin[]>;
}

export function BudgetPanel({ pins, days, buckets }: Props) {
  const selectPin = useTripStore((s) => s.selectPin);

  const summary = useMemo(() => {
    const total = sumCost(pins);
    const saved = sumCost(buckets.get(UNASSIGNED) ?? []);
    const byCategory = PIN_CATEGORIES.map((category) => {
      const inCategory = pins.filter((p) => p.category === category);
      return { category, amount: sumCost(inCategory), count: inCategory.length };
    })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.amount - a.amount);
    const byDay = days.map((day) => {
      const dayPins = buckets.get(day.date) ?? [];
      return { day, amount: sumCost(dayPins), count: dayPins.length };
    });
    const top = [...pins].filter((p) => p.cost > 0).sort((a, b) => b.cost - a.cost).slice(0, 5);
    const maxDay = Math.max(1, ...byDay.map((d) => d.amount));
    return { total, saved, scheduled: total - saved, byCategory, byDay, top, maxDay };
  }, [pins, days, buckets]);

  if (pins.length === 0) {
    return (
      <EmptyBudget />
    );
  }

  const perDay = days.length > 0 ? summary.scheduled / days.length : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-700/50 bg-gradient-to-br from-zinc-800/80 to-zinc-800/30 p-4">
        <p className="text-xs font-medium text-zinc-400">Estimated total</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-50 tabular-nums">{formatCurrency(summary.total)}</p>
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <Stat label="Scheduled" value={formatCurrency(summary.scheduled)} />
          <Stat label="Saved places" value={formatCurrency(summary.saved)} />
          <Stat label="Per day" value={formatCurrency(perDay)} />
        </div>
      </section>

      <section>
        <SectionTitle>By category</SectionTitle>
        <ul className="space-y-3">
          {summary.byCategory.map(({ category, amount, count }) => (
            <li key={category}>
              <div className="mb-1.5 flex items-center gap-2 text-[13px]">
                <CategoryIcon category={category} />
                <span className="text-zinc-200">{CATEGORY_LABELS[category]}</span>
                <span className="text-xs text-zinc-500">{count}</span>
                <span className="ml-auto font-medium text-zinc-100 tabular-nums">{formatCurrency(amount)}</span>
              </div>
              <Bar ratio={summary.total > 0 ? amount / summary.total : 0} color={CATEGORY_COLORS[category]} />
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>By day</SectionTitle>
        <ul className="space-y-2.5">
          {summary.byDay.map(({ day, amount, count }) => (
            <li key={day.date} className="flex items-center gap-3 text-[13px]">
              <span className="w-12 shrink-0 font-medium" style={{ color: day.color }}>
                Day {day.index}
              </span>
              <div className="flex-1">
                <Bar ratio={amount / summary.maxDay} color={day.color} />
              </div>
              <span className="w-16 shrink-0 text-right text-zinc-200 tabular-nums">{formatCurrency(amount)}</span>
              <span className="w-6 shrink-0 text-right text-xs text-zinc-500 tabular-nums">{count}</span>
            </li>
          ))}
          {summary.saved > 0 && (
            <li className="flex items-center gap-3 text-[13px]">
              <span className="flex w-12 shrink-0 items-center gap-1 font-medium text-zinc-400">
                <Bookmark className="size-3" /> Saved
              </span>
              <div className="flex-1">
                <Bar ratio={summary.saved / summary.maxDay} color={UNASSIGNED_COLOR} />
              </div>
              <span className="w-16 shrink-0 text-right text-zinc-200 tabular-nums">{formatCurrency(summary.saved)}</span>
              <span className="w-6 shrink-0 text-right text-xs text-zinc-500 tabular-nums">
                {(buckets.get(UNASSIGNED) ?? []).length}
              </span>
            </li>
          )}
        </ul>
      </section>

      {summary.top.length > 0 && (
        <section>
          <SectionTitle>Biggest expenses</SectionTitle>
          <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
            {summary.top.map((pin) => (
              <li key={pin.id}>
                <button
                  type="button"
                  onClick={() => selectPin(pin.id, { fly: true })}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors hover:bg-zinc-800/60"
                >
                  <CategoryIcon category={pin.category} />
                  <span className="min-w-0 flex-1 truncate text-zinc-200">{pin.name}</span>
                  <span className="font-medium text-zinc-100 tabular-nums">{formatCurrency(pin.cost, true)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900/60 px-2.5 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="mt-0.5 font-medium text-zinc-200 tabular-nums">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-3 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{children}</h3>;
}

function Bar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
      <motion.div
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(ratio > 0 ? 2 : 0, Math.min(1, ratio) * 100)}%` }}
        transition={{ type: 'spring', stiffness: 160, damping: 26 }}
      />
    </div>
  );
}

function EmptyBudget() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-zinc-800 px-6 py-10 text-center">
      <PiggyBank className="size-8 text-zinc-600" />
      <p className="mt-3 text-sm font-medium text-zinc-300">No costs yet</p>
      <p className="mt-1 text-xs text-zinc-500">Add places and set their cost to see a breakdown by category and day.</p>
    </div>
  );
}
