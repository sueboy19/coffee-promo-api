import type { DealCategory, ProductCategory } from '../types';

// ── Taiwan timezone helper ──

export function getTodayTaiwan(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/** Convert a UTC datetime string (e.g. "2026-04-28 13:27:33") to Taiwan timezone. */
export function toTaiwanTime(utcStr: string | null): string | null {
  if (!utcStr) return null;
  const d = new Date(utcStr + 'Z');
  if (isNaN(d.getTime())) return utcStr;
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).replace(',', '');
}

function getCurrentYearTaiwan(): number {
  return parseInt(getTodayTaiwan().substring(0, 4), 10);
}

// ── Date Parsing ──

export interface DateRange {
  start: string | null;
  end: string | null;
}

/**
 * Parse Chinese date range strings from cpok.tw tables.
 *
 * Supported formats:
 *   "2026/1/5~2/6"      → { start: "2026-01-05", end: "2026-02-06" }
 *   "2026/1/5~2026/2/6"  → { start: "2026-01-05", end: "2026-02-06" }
 *   "~2026/1/13"         → { start: null, end: "2026-01-13" }
 *   "8/1~8/3"            → { start: "2026-08-01", end: "2026-08-03" }  (short form)
 *   "~12/31"             → { start: null, end: "2026-12-31" }           (short form)
 *   "~2910/12/31"        → { start: null, end: null }                   (anomalous year)
 *   "到公告截止"           → { start: null, end: null }
 */
export function parseDateRange(raw: string): DateRange {
  if (!raw) return { start: null, end: null };

  const trimmed = raw.replace(/\s+/g, '').trim();

  // Strip trailing notes like "兌換期限：2026/1/31"
  const cleanDate = trimmed.replace(/兌換期限：?\d{4}\/\d{1,2}\/\d{1,2}/g, '').trim();

  // Pattern: "2026/1/5~2/6" or "2026/1/5~2026/2/6"
  const fullRange = cleanDate.match(
    /(\d{4})\/(\d{1,2})\/(\d{1,2})[~\-至](\d{1,4})\/?(\d{0,2})\/?(\d{0,2})/
  );
  if (fullRange) {
    const year = fullRange[1];
    const endPart1 = fullRange[4];
    const endPart2 = fullRange[5];
    const endPart3 = fullRange[6];

    const start = formatDate(year, fullRange[2], fullRange[3]);
    const yearNum = parseInt(year, 10);
    if (yearNum > 2100) return { start: null, end: null };

    let end: string;
    if (endPart1.length === 4) {
      if (parseInt(endPart1, 10) > 2100) return { start: null, end: null };
      end = formatDate(endPart1, endPart2, endPart3);
    } else {
      end = formatDate(year, endPart1, endPart2);
    }
    return { start, end };
  }

  // Pattern: "~2026/1/13" or "-2026/1/13"
  const endOnly = cleanDate.match(/[~\-至](\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (endOnly) {
    const yearNum = parseInt(endOnly[1], 10);
    if (yearNum > 2100) return { start: null, end: null };
    return { start: null, end: formatDate(endOnly[1], endOnly[2], endOnly[3]) };
  }

  // Short-form range: "8/1~8/3" or "1/5~2/6" (no year)
  const shortRange = cleanDate.match(
    /(\d{1,2})\/(\d{1,2})[~\-至](\d{1,2})\/(\d{1,2})/
  );
  if (shortRange) {
    const year = inferYear(parseInt(shortRange[1], 10), parseInt(shortRange[2], 10));
    const start = formatDate(String(year), shortRange[1], shortRange[2]);
    const endMonth = parseInt(shortRange[3], 10);
    const endDay = parseInt(shortRange[4], 10);
    const endYear = endMonth < parseInt(shortRange[1], 10) ? year + 1 : year;
    const end = formatDate(String(endYear), shortRange[3], shortRange[4]);
    return { start, end };
  }

  // Short-form end only: "~12/31" or "~1/15"
  const shortEndOnly = cleanDate.match(/[~\-至](\d{1,2})\/(\d{1,2})$/);
  if (shortEndOnly) {
    const month = parseInt(shortEndOnly[1], 10);
    const day = parseInt(shortEndOnly[2], 10);
    const year = inferYear(month, day);
    return { start: null, end: formatDate(String(year), shortEndOnly[1], shortEndOnly[2]) };
  }

  // Pattern: "2026/1/5~" (start only, no end)
  const startOnly = cleanDate.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})[~\-至]$/);
  if (startOnly) {
    return { start: formatDate(startOnly[1], startOnly[2], startOnly[3]), end: null };
  }

  return { start: null, end: null };
}

/** Infer the year for a short-form date. If the date has already passed this year, use next year. */
function inferYear(month: number, day: number): number {
  const currentYear = getCurrentYearTaiwan();
  const today = getTodayTaiwan();
  const candidate = `${currentYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return candidate >= today ? currentYear : currentYear + 1;
}

function formatDate(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// ── Deal Type Normalization ──

export interface NormalizedDeal {
  category: DealCategory;
  display: string;
}

const INVALID_DEAL_TYPES = new Set(['前往購買', '-', '']);

const DEAL_PATTERNS: { pattern: RegExp; category: DealCategory }[] = [
  { pattern: /買[一1]送[一1]/, category: 'bogo' },
  { pattern: /買\s*(\d+|[兩二三四五六七八九十])\s*送\s*(\d+|[兩二三四五六七八九十])/, category: 'buy_n_get_m' },
  { pattern: /第\s*[二2]\s*杯/, category: 'discount' },
  { pattern: /第[二2]杯半價/, category: 'discount' },
  { pattern: /\d+折/, category: 'discount' },
  { pattern: /半價/, category: 'discount' },
  { pattern: /加\d+元多一件/, category: 'discount' },
  { pattern: /^\d[\d,]*元$/, category: 'fixed_price' },
  { pattern: /\d+杯[\d,]+元/, category: 'bundle' },
  { pattern: /[\d,]+元.*杯/, category: 'bundle' },
  { pattern: /\d+杯.*[\d,]+元/, category: 'bundle' },
];

export function normalizeDealType(raw: string): NormalizedDeal {
  if (!raw) return { category: 'other', display: raw };

  const cleaned = raw.trim();

  if (INVALID_DEAL_TYPES.has(cleaned)) {
    return { category: 'other', display: cleaned };
  }

  for (const { pattern, category } of DEAL_PATTERNS) {
    if (pattern.test(cleaned)) {
      return { category, display: cleaned };
    }
  }

  return { category: 'other', display: cleaned };
}

// ── Row Normalization ──

export interface RawPromotionRow {
  product_name: string;
  deal_type: string;
  date_range: string;
}

export interface NormalizedPromotion {
  product_name: string;
  deal_type: string;
  deal_category: DealCategory;
  start_date: string | null;
  end_date: string | null;
}

export function normalizeRow(row: string[], brand: string): NormalizedPromotion | null {
  if (row.length < 2) return null;

  const product_name = row[0]?.trim();
  const deal_type = row[1]?.trim();
  const date_range = row[2]?.trim() || '';

  if (!product_name || !deal_type) return null;

  // Skip invalid deal types
  if (INVALID_DEAL_TYPES.has(deal_type)) return null;

  // Skip menu items (prices like "35元" without deal keywords)
  if (/^\d+元$/.test(deal_type) && !product_name.includes('買')) return null;

  let { category, display } = normalizeDealType(deal_type);

  // If deal_type didn't produce a useful category, check product_name for deal keywords
  if (category === 'other') {
    if (/買[一1]送[一1]/.test(product_name)) {
      category = 'bogo';
    } else if (/買\s*\d+\s*送\s*\d+/.test(product_name)) {
      category = 'buy_n_get_m';
    }
  }

  const { start, end } = parseDateRange(date_range);

  return {
    product_name,
    deal_type: display,
    deal_category: category,
    start_date: start,
    end_date: end,
  };
}

// ── Product Category Classification ──

const PRODUCT_KEYWORDS: { category: ProductCategory; keywords: string[] }[] = [
  {
    category: 'coffee',
    keywords: ['咖啡', '拿鐵', '美式', '拿铁', '卡布奇諾', '卡布奇诺', '摩卡', '濃縮', '浓缩', 'espree', 'café', 'cafe', 'latte', 'cappuccino', 'mocha', '濾掛', '滤挂', '即溶', '即溶', 'ucc', '伯朗', 'mr.brown', '褐色', '職人', '职人'],
  },
  {
    category: 'tea',
    keywords: ['茶', '紅茶', '绿茶', '綠茶', '烏龍', '乌龙', '奶茶', '青茶', '麥茶', '麦茶', '花茶', '茶飲', '茶饮', 'tea', '錫蘭', '锡兰', '伯爵', 'jasmine'],
  },
  {
    category: 'milk',
    keywords: ['牛奶', '鮮奶', '鲜奶', '鮮乳', '鲜乳', '乳品', '奶', 'milk', '豆漿', '豆浆', '豆奶', '優格', '优格', '優酪乳', '优酪乳', '乳'],
  },
  {
    category: 'juice',
    keywords: ['果汁', 'juice', '氣泡', '气泡', '汽水', '可樂', '可乐', '沙士', '運動', '饮料', '飲料', ' soda', 'water', '礦泉水', '純水'],
  },
  {
    category: 'bread',
    keywords: ['麵包', '面包', '吐司', '三明治', 'sandwich', '貝果', '贝果', '漢堡', '汉堡', '飯糰', '饭团', '沙拉', 'salad'],
  },
  {
    category: 'dessert',
    keywords: ['蛋糕', '甜點', '甜点', '布丁', '果凍', '果冻', '巧克力', 'chocolate', '餅乾', '饼干', 'donut', '甜甜圈', '冰', '冰淇淋', '霜淇淋', '霜', '提拉米蘇', '舒芙蕾', '大福', '麻糬'],
  },
];

export function classifyProduct(productName: string): ProductCategory {
  if (!productName) return 'other';
  const lower = productName.toLowerCase();

  for (const { category, keywords } of PRODUCT_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        return category;
      }
    }
  }
  return 'other';
}

export const PRODUCT_CATEGORY_LABELS: Record<ProductCategory, string> = {
  coffee: '咖啡',
  tea: '茶飲',
  milk: '牛奶/乳品',
  juice: '果汁/飲料',
  bread: '麵包/輕食',
  dessert: '甜點/零食',
  other: '其他',
};
