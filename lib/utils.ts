import { clsx, type ClassValue } from 'clsx';
import { format, isValid, parseISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { ISODate } from '@/types/trip';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function toISODate(date: Date): ISODate {
  return format(date, 'yyyy-MM-dd');
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

/** Parses `YYYY-MM-DD` as a local calendar date (no UTC shift). */
export function parseISODate(value: ISODate): Date | null {
  const date = parseISO(value);
  return isValid(date) ? date : null;
}

/** `Oct 18 – Oct 25` */
export function formatDateRange(start: ISODate, end: ISODate): string {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e) return '';
  return `${format(s, 'MMM d')} – ${format(e, 'MMM d')}`;
}

/** `Oct 18 – Oct 25, 2026`, used where the year matters (tooltips, past trips). */
export function formatDateRangeLong(start: ISODate, end: ISODate): string {
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e) return '';
  const sameYear = s.getFullYear() === e.getFullYear();
  return `${format(s, sameYear ? 'MMM d' : 'MMM d, yyyy')} – ${format(e, 'MMM d, yyyy')}`;
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const preciseCurrencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number, precise = false): string {
  return (precise ? preciseCurrencyFormatter : currencyFormatter).format(value);
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
