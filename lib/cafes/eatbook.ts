import * as cheerio from 'cheerio';
import { CAFE_TYPES, type Cafe, type CafeSource, type CafeType } from '@/lib/cafes/types';
import {
  areaForPostalCode,
  areaFromHeading,
  chargingFrom,
  compressWeeklyHours,
  halalFrom,
  isClosed,
  median,
  postalCodeIn,
  pricesIn,
  sameBusiness,
  slugify,
  tierFor,
  typesFrom,
} from '@/lib/cafes/classify';

/*
 * Server-only scraper for Eatbook (eatbook.sg) café guides. robots.txt allows general
 * crawlers on these pages. Only facts are kept (name, address, hours, prices, type,
 * charging, halal status) plus a link back to the guide entry: no article text.
 */

export interface EatbookArticle {
  url: string;
  /** Fallback when the page has no readable <h1>. */
  title: string;
  /** Every café in the guide is picked for working or studying. */
  workFriendly?: boolean;
  /** Every café in the guide takes CDC Vouchers. */
  cdcVouchers?: boolean;
}

export const EATBOOK_ARTICLES: readonly EatbookArticle[] = [
  { url: 'https://eatbook.sg/best-cafes-singapore/', title: 'Best Cafes In Singapore' },
  { url: 'https://eatbook.sg/quiet-cafes/', title: 'Quiet Cafes In Singapore', workFriendly: true },
  { url: 'https://eatbook.sg/cafes-cdc-vouchers-singapore/', title: 'Cafes In Singapore That Accept CDC Vouchers', cdcVouchers: true },
];

/** Generic client name; no personal details. */
export const SCRAPER_USER_AGENT = 'Mozilla/5.0 (compatible; WayfarerTripPlanner/0.1; +cafe-guide-reader)';

export type ScrapedCafe = Omit<Cafe, 'lat' | 'lng'>;

const squash = (text: string) => text.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function tidyHours(raw: string): string {
  return squash(raw)
    .replace(/\bThurs?\b/g, 'Thu')
    .replace(/\bTues\b/g, 'Tue')
    .replace(/\bWeds\b/g, 'Wed')
    .replace(/\s+to\s+/gi, '–')
    .replace(/(\b[A-Z][a-z]{2,4})-([A-Z][a-z]{2,4}\b)/g, '$1–$2')
    .replace(/[,;]\s*$/, '');
}

function tidyAddress(raw: string): string {
  return squash(raw).replace(/\s+,/g, ',').replace(/[,;]\s*$/, '');
}

/** Parses one guide page into cafés, in the guide's order. Exported for testing against saved HTML. */
export function parseEatbookArticle(html: string, article: EatbookArticle): { title: string; cafes: ScrapedCafe[] } {
  const $ = cheerio.load(html);
  const root = $('article').first();
  const title = squash($('h1').first().text()) || article.title;
  const cafes: ScrapedCafe[] = [];
  let area: string | null = null;

  root.find('h2, h3').each((_, heading) => {
    const $heading = $(heading);
    if ($heading.is('h2')) {
      area = areaFromHeading($heading.text());
      return;
    }
    // Cafés are numbered h3s ("12. Kith Cafe"); anything else is an aside.
    const numbered = squash($heading.text()).match(/^\d+\.\s*(.+)$/);
    if (!numbered?.[1]) return;
    const name = numbered[1].trim();
    const anchor = $heading.find('[id]').first().attr('id') ?? $heading.attr('id') ?? null;

    const prose: string[] = [];
    let address: string | null = null;
    let hours: string | null = null;
    let website: string | null = null;

    for (let el = $heading.next(); el.length > 0 && !el.is('h2, h3'); el = el.next()) {
      if (el.is('blockquote, figure, script, style, noscript')) continue;

      // Structured listing card: "Address <addr> Opening Hours: Monday …".
      if (el.is('.tsl-fd') || el.find('.exp-card').length > 0) {
        const panel = squash(el.find('[id^="exp-tab-address-"]').text() || el.text());
        address ??= panel.match(/Address\s+(.+?)\s+Opening Hours:/i)?.[1] ?? null;
        hours ??= compressWeeklyHours(panel);
        continue;
      }

      const text = squash(el.text());
      if (!text || /^Image credit:/i.test(text)) continue;

      website ??=
        el
          .find('a')
          .filter((__, a) => squash($(a).text()).toLowerCase() === 'website')
          .first()
          .attr('href') ?? null;

      // Plain listing line: "Address: … Opening hours: … Tel: … Website …" (first branch wins).
      const line = text.match(/(?:^|\s)Address:\s*(.+?)(?=\s+(?:Opening hours:|Tel:|Website\b)|$)/i);
      if (line?.[1]) {
        address ??= line[1];
        hours ??= text.match(/Opening hours:\s*(.+?)(?=\s+Tel:|\s+Website\b|$)/i)?.[1] ?? null;
      }
      prose.push(text);
    }

    const body = prose.join(' ');
    if (!address || isClosed(body)) return;

    const prices = pricesIn(body);
    const types = new Set<CafeType>(typesFrom(body));
    if (article.workFriendly) types.add('work-friendly');
    if (types.size > 1) types.delete('cafe');
    const postalCode = postalCodeIn(address);

    cafes.push({
      id: slugify(name),
      name,
      area: area ?? areaForPostalCode(postalCode),
      address: tidyAddress(address),
      postalCode,
      hours: hours ? tidyHours(hours) : null,
      priceMin: prices.length > 0 ? Math.min(...prices) : null,
      priceMax: prices.length > 0 ? Math.max(...prices) : null,
      priceTier: tierFor(median(prices)),
      types: CAFE_TYPES.filter((t) => types.has(t)),
      charging: chargingFrom(body),
      halal: halalFrom(body),
      cdcVouchers: article.cdcVouchers === true,
      chain: false,
      website,
      sourceUrl: anchor ? `${article.url}#${anchor}` : article.url,
      sourceTitle: title,
    });
  });

  return { title, cafes };
}

/**
 * Same café in two guides (the same name at the same postcode, e.g. "No Horse Run" and "No Horse
 * Run Cafe"): keep the first listing, fill gaps from the second, union the types. The same name at
 * another postcode is another branch and stays its own entry, so its details (and whether it
 * takes CDC Vouchers) stay with the right address.
 */
export function mergeCafes(lists: ScrapedCafe[][]): ScrapedCafe[] {
  const merged: ScrapedCafe[] = [];
  const ids = new Set<string>();
  for (const cafe of lists.flat()) {
    const index = merged.findIndex((m) =>
      m.postalCode && cafe.postalCode ? m.postalCode === cafe.postalCode && sameBusiness(m.name, cafe.name) : m.id === cafe.id,
    );
    if (index === -1) {
      const id = ids.has(cafe.id) ? `${cafe.id}-${cafe.postalCode ?? merged.length}` : cafe.id;
      ids.add(id);
      merged.push({ ...cafe, id });
      continue;
    }
    const existing = merged[index]!;
    const types = new Set([...existing.types, ...cafe.types]);
    if (types.size > 1) types.delete('cafe');
    merged[index] = {
      ...existing,
      area: existing.area ?? cafe.area,
      hours: existing.hours ?? cafe.hours,
      priceMin: existing.priceMin ?? cafe.priceMin,
      priceMax: existing.priceMax ?? cafe.priceMax,
      priceTier: existing.priceTier ?? cafe.priceTier,
      types: CAFE_TYPES.filter((t) => types.has(t)),
      charging: existing.charging ?? cafe.charging,
      halal: existing.halal ?? cafe.halal,
      cdcVouchers: existing.cdcVouchers || cafe.cdcVouchers,
      website: existing.website ?? cafe.website,
    };
  }
  return merged;
}

/**
 * Fetches each guide one after another (polite, and the pages are large). One guide failing
 * doesn't sink the others; all failing throws.
 */
export async function scrapeEatbook(): Promise<{ cafes: ScrapedCafe[]; sources: CafeSource[] }> {
  const lists: ScrapedCafe[][] = [];
  const sources: CafeSource[] = [];
  const failures: string[] = [];

  for (const article of EATBOOK_ARTICLES) {
    try {
      const response = await fetch(article.url, {
        headers: { 'User-Agent': SCRAPER_USER_AGENT, Accept: 'text/html' },
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { title, cafes } = parseEatbookArticle(await response.text(), article);
      lists.push(cafes);
      sources.push({ title, url: article.url, count: cafes.length });
    } catch (error) {
      failures.push(`${article.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (lists.length === 0) throw new Error(`Couldn’t reach Eatbook (${failures.join('; ')})`);
  if (failures.length > 0) console.warn('[cafes] some guides failed:', failures);
  return { cafes: mergeCafes(lists), sources };
}
