import type { CafeType, HalalStatus, PriceTier } from '@/lib/cafes/types';

/*
 * Pure text rules over one café's section of a guide. Guides quote prices per dish and
 * describe the café in prose, so everything here is derived, not read from a field.
 */

/* ---------------------------------------------------------------- prices --- */

const PRICE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d.])/g;

/** Every S$ figure in the text ("$13.90++", "($42)"), ignoring "price TBD". */
export function pricesIn(text: string): number[] {
  const prices: number[] = [];
  for (const match of text.matchAll(PRICE)) {
    const value = Number(match[1]);
    if (value > 0 && value < 300) prices.push(value);
  }
  return prices;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** From the typical (median) dish, so one sharing platter doesn't make a café look pricey. */
export function tierFor(typical: number | null): PriceTier | null {
  if (typical === null) return null;
  if (typical <= 10) return '$';
  if (typical <= 25) return '$$';
  return '$$$';
}

/* ----------------------------------------------------------------- types --- */

interface TypeRule {
  type: CafeType;
  /** One hit is enough: the guide calls it this. */
  strong: RegExp;
  /** Needs two hits: menu items and vibes that hint at it. */
  weak: RegExp;
}

const TYPE_RULES: TypeRule[] = [
  {
    type: 'specialty-coffee',
    strong: /speciality coffee|specialty coffee|coffee roaster|roastery|single[- ]origin|pour[- ]?over|filter coffee|coffee bar/i,
    weak: /\b(?:espresso|latte|flat white|cold brew|baristas?|beans|cuppas?|long black|piccolo)\b/gi,
  },
  {
    type: 'brunch',
    strong: /\bbrunch\b|all[- ]day breakfast|big breakfast/i,
    weak: /\b(?:eggs? benedict|pancakes?|hotcakes?|french toast|avocado toast|scrambled eggs|breakfast|shakshuka)\b/gi,
  },
  {
    type: 'bakery',
    strong: /bakery|bakehouse|boulangerie|patisserie|viennoiserie/i,
    weak: /\b(?:croissants?|sourdough|danish|pastr(?:y|ies)|bagels?|bakes|loaf|cupcakes?|scones?|galettes?|brownies?)\b/gi,
  },
  {
    type: 'dessert',
    strong: /dessert (?:cafe|spot|bar|place|parlour)|desserts? cafe|gelato|bingsu|soft serve|ice cream (?:cafe|parlour|shop)/i,
    weak: /\b(?:desserts?|cakes?|waffles?|tiramisu|ice cream|tarts?|parfaits?|durian|mochi|puddings?)\b/gi,
  },
  {
    type: 'traditional',
    strong: /kaya toast|kopitiam|nanyang (?:coffee|kopi)|traditional (?:kopi|coffee)|\bkopi[- ](?:o|c|peng|siew dai)\b/i,
    // Not "toast" on its own: French and avocado toast are brunch.
    weak: /\b(?:kopi|kaya|teh|soft[- ]boiled eggs)\b/gi,
  },
  {
    type: 'work-friendly',
    strong: /work[- ]friendly|co-?working|remote work|laptops?|study(?:ing)? (?:spot|cafe|session)|for (?:studying|working)/i,
    weak: /\b(?:wi-?fi|charging (?:points?|ports?|stations?)|power (?:points?|sockets?)|quiet|plugs?)\b/gi,
  },
];

export function typesFrom(text: string): CafeType[] {
  const found = TYPE_RULES.filter(({ strong, weak }) => strong.test(text) || (text.match(weak)?.length ?? 0) >= 2).map(
    (rule) => rule.type,
  );
  return found.length > 0 ? found : ['cafe'];
}

/* -------------------------------------------------------------- charging --- */

const POWER = /charging (?:points?|ports?|stations?|sockets?)|power (?:points?|sockets?|outlets?)|plug points?|\bplugs\b|\bsockets\b/i;
const NEGATED = /\b(?:no|not|without|zero|lacks?|lacking|isn['’]t|aren['’]t|don['’]t)\b/i;
/** "Their other branches have charging points": true somewhere, but not at this address. */
const ELSEWHERE = /\b(?:other|some|selected|certain) (?:branches|outlets)\b/i;

/** true / false when the text says so; null when power isn't mentioned or only applies to other branches. */
export function chargingFrom(text: string): boolean | null {
  let yes = false;
  let no = false;
  let elsewhere = false;
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const hit = sentence.match(POWER);
    if (!hit || hit.index === undefined) continue;
    if (ELSEWHERE.test(sentence)) elsewhere = true;
    // Negation has to come before the power phrase: "there are no charging points".
    else if (NEGATED.test(sentence.slice(0, hit.index))) no = true;
    else yes = true;
  }
  // Contradictory or other-branches-only mentions stay unknown rather than guessing.
  if (yes && !no) return true;
  if (no && !yes && !elsewhere) return false;
  return null;
}

/* ----------------------------------------------------------------- other --- */

export function halalFrom(text: string): HalalStatus | null {
  if (/no pork (?:or|and|\/|&) lard|pork[- ]free/i.test(text)) return 'no-pork-lard';
  if (/\bis (?:a )?halal[- ]certified|\bis halal\b/i.test(text)) return 'certified';
  if (/not (?:a )?halal[- ]certified/i.test(text)) return 'not-certified';
  return null;
}

export function isClosed(text: string): boolean {
  return /(?:temporarily|permanently) closed|has (?:since )?closed|closed (?:for good|its doors)|ceased operations/i.test(text);
}

export function postalCodeIn(text: string): string | null {
  return text.match(/Singapore\s*(\d{6})\b/i)?.[1] ?? text.match(/\b(\d{6})\b/)?.[1] ?? null;
}

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* -------------------------------------------------------------- matching --- */

const MATCH_STOPWORDS = new Set(
  'the and n cafe cafes coffee co sg pte ltd llp bakery bakehouse bar house shop by at s'.split(' '),
);

/** Matching runs over thousands of names per refresh, many of them repeats. */
const tokenMemo = new Map<string, string[]>();

function matchTokens(name: string): string[] {
  let tokens = tokenMemo.get(name);
  if (!tokens) {
    if (tokenMemo.size > 50_000) tokenMemo.clear();
    tokens = tokenize(name);
    tokenMemo.set(name, tokens);
  }
  return tokens;
}

function tokenize(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !MATCH_STOPWORDS.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/** "Puff And Peaks" ~ "PUFFS AND PEAKS BAKERY CAFE"; "Meadowbrewsg" ~ "MEADOW BREW"; "Nylon Coffee" ~ "NYLON COFFEE ROASTERS". */
export function sameBusiness(a: string, b: string): boolean {
  const ta = matchTokens(a);
  const tb = matchTokens(b);
  if (ta.length === 0 || tb.length === 0) return slugify(a) === slugify(b);
  const ca = ta.join('');
  const cb = tb.join('');
  if (ca === cb) return true;
  if (Math.min(ca.length, cb.length) >= 4 && (ca.includes(cb) || cb.includes(ca))) return true;
  const shared = ta.filter((t) => t.length >= 3 && tb.includes(t)).length;
  return shared > 0 && shared / Math.min(ta.length, tb.length) >= 0.5;
}

/* ----------------------------------------------------------------- hours --- */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const DAY_SHORT: Record<(typeof DAYS)[number], string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

/** "08:30 AM" → "8:30am", "12:00 PM" → "12pm". */
function shortTime(value: string): string {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (!m) return value.trim();
  const hour = String(Number(m[1]));
  const minutes = m[2] === '00' ? '' : `:${m[2]}`;
  return `${hour}${minutes}${m[3]!.toLowerCase()}`;
}

/**
 * Compresses a per-day schedule ("Monday 08:30 AM - 06:00 PM Tuesday …") into
 * "Daily 8:30am–6pm" or "Mon–Fri 8am–5pm, Sat–Sun 9am–6pm".
 */
export function compressWeeklyHours(text: string): string | null {
  const byDay = new Map<string, string>();
  const pattern = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(Closed|\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M)/gi;
  for (const match of text.matchAll(pattern)) {
    const day = DAYS.find((d) => d.toLowerCase() === match[1]!.toLowerCase());
    if (!day || byDay.has(day)) continue;
    const slot = match[2]!;
    byDay.set(
      day,
      /closed/i.test(slot)
        ? 'Closed'
        : slot
            .split('-')
            .map((part) => shortTime(part))
            .join('–'),
    );
  }
  if (byDay.size === 0) return null;

  const groups: { from: string; to: string; hours: string }[] = [];
  for (const day of DAYS) {
    const hours = byDay.get(day);
    if (!hours) continue;
    const last = groups[groups.length - 1];
    if (last && last.hours === hours && DAYS.indexOf(last.to as (typeof DAYS)[number]) === DAYS.indexOf(day) - 1) last.to = day;
    else groups.push({ from: day, to: day, hours });
  }
  if (groups.length === 1 && byDay.size === 7) return `Daily ${groups[0]!.hours}`;
  return groups
    .map((g) => {
      const from = DAY_SHORT[g.from as (typeof DAYS)[number]];
      const to = DAY_SHORT[g.to as (typeof DAYS)[number]];
      return `${from === to ? from : `${from}–${to}`} ${g.hours}`;
    })
    .join(', ');
}

/* ------------------------------------------------------------------ area --- */

/** Singapore postal sector (first two digits) → general location (URA postal districts). */
const POSTAL_AREAS: [sectors: string[], area: string][] = [
  [['01', '02', '03', '04', '05', '06'], 'Raffles Place & Marina'],
  [['07', '08'], 'Tanjong Pagar'],
  [['14', '15', '16'], 'Queenstown & Tiong Bahru'],
  [['09', '10'], 'Telok Blangah & HarbourFront'],
  [['11', '12', '13'], 'Pasir Panjang & Clementi'],
  [['17'], 'Beach Road'],
  [['18', '19'], 'Bugis & Golden Mile'],
  [['20', '21'], 'Little India'],
  [['22', '23'], 'Orchard & River Valley'],
  [['24', '25', '26', '27'], 'Bukit Timah & Holland'],
  [['28', '29', '30'], 'Novena & Thomson'],
  [['31', '32', '33'], 'Balestier & Toa Payoh'],
  [['34', '35', '36', '37'], 'Macpherson & Braddell'],
  [['38', '39', '40', '41'], 'Geylang & Eunos'],
  [['42', '43', '44', '45'], 'Katong & Joo Chiat'],
  [['46', '47', '48'], 'Bedok & Upper East Coast'],
  [['49', '50', '81'], 'Changi & Loyang'],
  [['51', '52'], 'Tampines & Pasir Ris'],
  [['53', '54', '55', '82'], 'Serangoon, Hougang & Punggol'],
  [['56', '57'], 'Bishan & Ang Mo Kio'],
  [['58', '59'], 'Upper Bukit Timah'],
  [['60', '61', '62', '63', '64'], 'Jurong'],
  [['65', '66', '67', '68'], 'Bukit Panjang & Choa Chu Kang'],
  [['69', '70', '71'], 'Lim Chu Kang & Tengah'],
  [['72', '73'], 'Kranji & Woodlands'],
  [['77', '78'], 'Upper Thomson'],
  [['75', '76'], 'Yishun & Sembawang'],
  [['79', '80'], 'Seletar'],
];

export function areaForPostalCode(postal: string | null): string | null {
  if (!postal) return null;
  const sector = postal.slice(0, 2);
  return POSTAL_AREAS.find(([sectors]) => sectors.includes(sector))?.[1] ?? null;
}

/** "Chinatown, Everton Park, and Outram Park cafes" → "Chinatown, Everton Park & Outram Park". */
export function areaFromHeading(heading: string): string | null {
  const text = heading
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^cafes in (?:the )?/i, '')
    .replace(/\s+cafes$/i, '')
    .replace(/,? and /i, ' & ');
  if (!text || /best cafes|singapore/i.test(text)) return null;
  return /^(north|south|east|west|north-east|north-west|central)$/i.test(text) ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text;
}
