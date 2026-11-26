import {
  CAFE_TYPE_LABELS,
  CHARGING_LABEL,
  HALAL_LABEL,
  chargingKey,
  formatPriceRange,
  type Cafe,
} from '@/lib/cafes/types';

type CellValue = string | number | null;

const COLUMNS: [header: string, value: (cafe: Cafe) => CellValue][] = [
  ['Name', (c) => c.name],
  ['Area', (c) => c.area],
  ['Address', (c) => c.address],
  ['Postal code', (c) => c.postalCode],
  // "S$8–18" rather than "8-18", which Excel would turn into a date.
  ['Price range', (c) => formatPriceRange(c)],
  ['Price tier', (c) => c.priceTier],
  ['Cafe type', (c) => c.types.map((t) => CAFE_TYPE_LABELS[t]).join('; ')],
  ['Charging ports', (c) => CHARGING_LABEL[chargingKey(c.charging)]],
  ['Halal', (c) => (c.halal ? HALAL_LABEL[c.halal] : null)],
  ['CDC vouchers', (c) => (c.cdcVouchers ? 'Yes' : 'Not listed')],
  ['Chain', (c) => (c.chain ? 'Yes' : 'No')],
  ['Opening hours', (c) => c.hours],
  ['Latitude', (c) => c.lat],
  ['Longitude', (c) => c.lng],
  ['Website', (c) => c.website],
  ['Source', (c) => c.sourceUrl],
];

function cell(value: CellValue): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(value);
  // Scraped text must not run as a spreadsheet formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows "Café" and "–" correctly. */
export function cafesToCsv(cafes: Cafe[]): string {
  const rows = [COLUMNS.map(([header]) => header), ...cafes.map((cafe) => COLUMNS.map(([, value]) => cell(value(cafe))))];
  return `﻿${rows.map((row) => row.join(',')).join('\r\n')}\r\n`;
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the download a moment to start before the blob goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
