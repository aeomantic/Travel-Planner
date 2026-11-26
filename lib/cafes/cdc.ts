import { gunzipSync } from 'node:zlib';
import { CAFE_TYPES, isInSingapore, type Cafe, type CafeSource, type CafeType } from '@/lib/cafes/types';
import { areaForPostalCode, sameBusiness, slugify } from '@/lib/cafes/classify';
import { NearbyIndex } from '@/lib/cafes/geo';
import { SCRAPER_USER_AGENT } from '@/lib/cafes/eatbook';

/*
 * Server-only reader for the official CDC Vouchers merchant directory: the data file behind
 * gowhere.gov.sg/cdcvouchers, listing every participating hawker and heartland merchant with
 * its address and coordinates, but no category. It's used two ways:
 *   1. a café from the guides is marked as taking CDC Vouchers when the directory lists the
 *      same business at the same place;
 *   2. merchants whose names say café, coffee, bakery or dessert are added as cafés of their own.
 */

export const CDC_DIRECTORY_URL = 'https://prd-tmp.cdn.gowhere.gov.sg/assets/cdcvouchersgowhere/data.gzip?v=2';
export const CDC_DIRECTORY_PAGE = 'https://www.gowhere.gov.sg/cdcvouchers';

export interface CdcMerchant {
  name: string;
  address: string;
  postalCode: string | null;
  lat: number;
  lng: number;
}

export interface CdcDirectory {
  merchants: CdcMerchant[];
  /** As the directory states it, e.g. "26 Nov 2026". */
  updated: string | null;
}

/* ------------------------------------------------------------------ fetch --- */

/** Exported for testing against a saved copy of the file. */
export function parseCdcDirectory(json: unknown): CdcDirectory {
  const { locations, lastUpdated } = (json ?? {}) as { locations?: unknown; lastUpdated?: unknown };
  if (!Array.isArray(locations)) throw new Error('CDC directory has no "locations" list; its format may have changed');

  const merchants: CdcMerchant[] = [];
  for (const entry of locations as unknown[]) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, address, postalCode, LAT, LON } = entry as Record<string, unknown>;
    const lat = Number(LAT);
    const lng = Number(LON);
    if (typeof name !== 'string' || typeof address !== 'string' || !isInSingapore(lat, lng)) continue;
    merchants.push({
      name: name.replace(/\s+/g, ' ').trim(),
      address,
      postalCode: typeof postalCode === 'string' && /^\d{6}$/.test(postalCode) ? postalCode : null,
      lat,
      lng,
    });
  }
  return { merchants, updated: typeof lastUpdated === 'string' ? lastUpdated : null };
}

export async function fetchCdcDirectory(): Promise<CdcDirectory> {
  const response = await fetch(CDC_DIRECTORY_URL, {
    headers: { 'User-Agent': SCRAPER_USER_AGENT, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`CDC directory: HTTP ${response.status}`);
  let bytes = Buffer.from(await response.arrayBuffer());
  // fetch normally undoes the Content-Encoding already; this covers a copy served as a raw .gzip file.
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  return parseCdcDirectory(JSON.parse(bytes.toString('utf8')));
}

/* ---------------------------------------------------------- which are cafés --- */

const CAFE_WORDS =
  /\b(?:caf[eé]s?|coffee|espresso|roast(?:er|ers|ery)|brew(?:s|ers|ery|ing)?|bak(?:e|es|ery|ehouse)|patisserie|boulangerie|gelato|gelateria|creamery|desserts?|bingsu|waffles?|brunch|kopi)\b/i;

const NOT_CAFES = new RegExp(
  [
    // Coffeeshops (kopitiams), their drink stalls, and food courts.
    String.raw`coffee ?shop|kopitiam|eating ?house|food ?(?:court|centre|center|house|hall)|canteen|cafeteria|\bdrinks?\b|beverages?|\bstall\b`,
    // Coffeeshop operators named after their block: "ST 82 Coffee House Pte Ltd", "Bishan 120 Kopi Place".
    String.raw`kopi place|coffee hub|\d\w*\s+coffee (?:house|station)|coffee (?:house|station)\s+\d|coffee house pte|kimly`,
    // Hawker dishes and restaurants that happen to say café or dessert.
    String.raw`restaurant|zi ?char|noodles?|\brice\b|chicken|\bfish\b|duck|prawn|seafood|satay|\bmee\b|kway|laksa|nasi|prata|roti|curry|porridge|congee|bbq|steamboat|hot ?pot|kebab|rojak|ngoh hiang|briyani|biryani`,
    String.raw`(?:hot|cold) (?:&|and) (?:hot|cold)|soya ?bean|beancurd|tau huay`,
    // Not places to eat.
    String.raw`coffee powder|biscuits|mini ?mart|supermarket|provision|trading|wholesale|suppl(?:y|ies)|distributors?|catering|aesthetic|beauty|salon|\bspa\b`,
  ].join('|'),
  'i',
);

/** Words that don't tell one stall from another: "Coffee & Tea", "Kopi 273", "Dessert". */
const GENERIC = new Set(
  'the and n cafe cafes coffee tea kopi toast bread dessert desserts waffle waffles bake bakes bakery traditional hot cold house pte ltd llp co s'.split(
    ' ',
  ),
);

export function isCafeName(name: string): boolean {
  if (!CAFE_WORDS.test(name) || NOT_CAFES.test(name)) return false;
  const distinctive = name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/caf[eé]/g, 'cafe')
    .split(/[^a-z]+/)
    .filter((word) => word.length > 1 && !GENERIC.has(word));
  return distinctive.length > 0;
}

const NAME_TYPES: [CafeType, RegExp][] = [
  ['specialty-coffee', /roast(?:er|ers|ery)\b|espresso|brew bar|slow bar|coffee bar|specialty coffee|coffee co\b|coffee factory|craft coffee/i],
  ['brunch', /brunch/i],
  ['bakery', /\bbak(?:e|es|ery|ehouse)\b|boulangerie|patisserie|confection|bread|\btarts?\b|\bpuffs?\b|\bcakes?\b/i],
  ['dessert', /dessert|gelat|creamery|ice[- ]?cream|waffle|bingsu|scoops|durian|acai/i],
  [
    'traditional',
    /\bkopi\b|toast|traditional|nanyang|hainan|hylam|coffee (?:&|and|n) (?:tea|bread)|coffee house|(?:old|ancient) coffee|19[5-8]0s/i,
  ],
];

export function typesFromName(name: string): CafeType[] {
  const found = new Set(NAME_TYPES.filter(([, pattern]) => pattern.test(name)).map(([type]) => type));
  return found.size > 0 ? CAFE_TYPES.filter((t) => found.has(t)) : ['cafe'];
}

/* ------------------------------------------------------------ presentation --- */

const COMPANY_SUFFIX = /[\s,.-]*\b(?:pte\.?\s*ltd\.?|ptd\.?\s*ltd\.?|private limited|limited liability pa\w*|llp|ltd\.?)\s*$/i;
const TRAILING_PARENS = /\s*\([^)]*\)\s*$/;
/** "Xin He Yun Cafe #01-34": the unit is in the address. */
const TRAILING_UNIT = /\s*#\s?[\dB]+-[\w]+$/i;
/** Abbreviations that keep their capitals even though they have vowels. */
const UPPER = new Set(['AMK', 'TPY', 'CCK', 'NTU', 'NUS', 'NYP', 'ITE', 'UEC', 'SG', 'HK', 'JC', 'CBD', 'UK', 'USA', 'SIT', 'SMU', 'AM', 'PM']);
/** Short words with no a/e/i/o/u that aren't abbreviations. */
const WORDS: Record<string, string> = { MY: 'My', BY: 'by', ST: 'St', MR: 'Mr', MRS: 'Mrs', MS: 'Ms', DR: 'Dr', N: 'n', X: 'x', SKY: 'Sky', FLY: 'Fly', SHY: 'Shy', DRY: 'Dry', WHY: 'Why' };

function titleCase(text: string): string {
  return text.replace(/[A-Za-z0-9][A-Za-z0-9'’]*/g, (word) => {
    const upper = word.toUpperCase();
    if (WORDS[upper]) return WORDS[upper]!;
    if (/\d/.test(word)) return /^\d+S$/i.test(word) ? word.toLowerCase() : upper; // "1970s", "8P", "AMK631"
    if (UPPER.has(upper) || !/[aeiou]/i.test(word)) return upper; // "DJ", "HC", "C&T"
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

/** "SWEE HENG BAKERY (SHB02)" → "Swee Heng Bakery"; "37 BREW CAFE LLP" → "37 Brew Cafe". The address says which branch. */
export function displayName(raw: string): string {
  let name = raw.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 2; i++) {
    name = name.replace(TRAILING_PARENS, '').replace(COMPANY_SUFFIX, '').replace(TRAILING_UNIT, '').trim();
  }
  return titleCase(name || raw);
}

/** "861 North Bridge Road, #01-83,  S198783;" → "861 North Bridge Road, #01-83, Singapore 198783". */
export function tidyDirectoryAddress(raw: string, postalCode: string | null): string {
  let text = raw
    .replace(/\s+/g, ' ')
    .replace(/[;,\s]+$/, '')
    .replace(/,?\s*S\d{6}$/, '')
    .replace(/[;,\s]+$/, '')
    .replace(/\s+,/g, ',');
  // "165 Bukit Merah Central Singapore 150165, #01-3685": the unit goes before the postcode.
  const unitAfterPostcode = text.match(/^(.*?),?\s+Singapore (\d{6}),\s*(#.+)$/);
  if (unitAfterPostcode) text = `${unitAfterPostcode[1]}, ${unitAfterPostcode[3]}, Singapore ${unitAfterPostcode[2]}`;
  else if (postalCode && !text.includes(postalCode)) text = `${text}, Singapore ${postalCode}`;
  return text;
}

/* ---------------------------------------------------------------- matching --- */

/** Guide addresses and directory postcodes don't always agree, so a listing this close also counts. */
const SAME_PLACE_M = 100;

/**
 * Marks cafés from the other sources that the directory lists (same business, same postcode or
 * within 100 m) as taking CDC Vouchers, and returns the directory's other cafés.
 */
export function applyCdcDirectory(cafes: Cafe[], directory: CdcDirectory): { cafes: Cafe[]; added: Cafe[] } {
  const { merchants } = directory;
  const byPostal = new Map<string, CdcMerchant[]>();
  for (const m of merchants) {
    if (!m.postalCode) continue;
    const list = byPostal.get(m.postalCode);
    if (list) list.push(m);
    else byPostal.set(m.postalCode, [m]);
  }
  const nearby = new NearbyIndex(merchants);

  const matched = new Set<CdcMerchant>();
  const marked = cafes.map((cafe) => {
    const candidates = new Set(cafe.postalCode ? (byPostal.get(cafe.postalCode) ?? []) : []);
    if (cafe.lat !== null && cafe.lng !== null) {
      for (const m of nearby.near({ lat: cafe.lat, lng: cafe.lng }, SAME_PLACE_M)) candidates.add(m);
    }
    let listed = false;
    for (const m of candidates) {
      if (sameBusiness(cafe.name, m.name)) {
        matched.add(m);
        listed = true;
      }
    }
    return listed && !cafe.cdcVouchers ? { ...cafe, cdcVouchers: true } : cafe;
  });

  const taken = new Set(marked.map((c) => c.id));
  const addedAt = new Map<string, string[]>();
  const added: Cafe[] = [];
  merchants.forEach((m) => {
    if (matched.has(m) || !isCafeName(m.name)) return;
    const name = displayName(m.name);
    // Branches share a name, so the postcode keeps their ids apart.
    const id = `${slugify(name)}-${m.postalCode ?? `${m.lat.toFixed(4)}-${m.lng.toFixed(4)}`}`;
    // The directory lists some stalls twice ("Xin He Yun Cafe", "XIN HE YUN CAFE #01-34").
    const neighbours = m.postalCode ? (addedAt.get(m.postalCode) ?? []) : [];
    if (taken.has(id) || neighbours.some((other) => sameBusiness(other, name))) return;
    taken.add(id);
    if (m.postalCode) addedAt.set(m.postalCode, [...neighbours, name]);
    added.push({
      id,
      name,
      area: areaForPostalCode(m.postalCode),
      address: tidyDirectoryAddress(m.address, m.postalCode),
      postalCode: m.postalCode,
      lat: m.lat,
      lng: m.lng,
      hours: null,
      priceMin: null,
      priceMax: null,
      priceTier: null,
      types: typesFromName(m.name),
      charging: null,
      halal: null,
      cdcVouchers: true,
      chain: false,
      website: null,
      sourceUrl: `${CDC_DIRECTORY_PAGE}?${new URLSearchParams({ result: m.name, sort: 'relevance', status: 'success' })}`,
      sourceTitle: 'CDC Vouchers GoWhere',
    });
  });
  return { cafes: marked, added };
}

/** Postal code → building coordinates: in Singapore a postal code is a single building. */
export function postcodeIndex(directory: CdcDirectory): Map<string, { lat: number; lng: number }> {
  const index = new Map<string, { lat: number; lng: number }>();
  for (const m of directory.merchants) {
    if (m.postalCode && !index.has(m.postalCode)) index.set(m.postalCode, { lat: m.lat, lng: m.lng });
  }
  return index;
}

export function cdcSource(directory: CdcDirectory, count: number): CafeSource {
  return {
    title: `CDC Vouchers merchant directory${directory.updated ? ` (as of ${directory.updated})` : ''}`,
    url: CDC_DIRECTORY_PAGE,
    count,
  };
}
