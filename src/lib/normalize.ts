import type { DealCategory } from '../types';

// ── Date Parsing ──

export interface DateRange {
  start: string | null;
  end: string | null;
}

/**
 * Parse Chinese date range strings from cpok.tw tables.
 *
 * Examples:
 *   "2026/1/5~2/6"     → { start: "2026-01-05", end: "2026-02-06" }
 *   "2026/1/5~2026/2/6" → { start: "2026-01-05", end: "2026-02-06" }
 *   "~2026/1/13"        → { start: null, end: "2026-01-13" }
 *   "到公告截止"          → { start: null, end: null }
 */
export function parseDateRange(raw: string): DateRange {
  if (!raw) return { start: null, end: null };

  const trimmed = raw.replace(/\s+/g, '').trim();

  // Pattern: "2026/1/5~2/6" or "2026/1/5~2026/2/6"
  const fullRange = trimmed.match(
    /(\d{4})\/(\d{1,2})\/(\d{1,2})[~\-至](\d{1,4})\/?(\d{0,2})\/?(\d{0,2})/
  );
  if (fullRange) {
    const year = fullRange[1];
    const endPart1 = fullRange[4];
    const endPart2 = fullRange[5];
    const endPart3 = fullRange[6];

    const start = formatDate(year, fullRange[2], fullRange[3]);

    let end: string;
    if (endPart1.length === 4) {
      // Full year: "2026/2/6"
      end = formatDate(endPart1, endPart2, endPart3);
    } else {
      // Month/day only: "2/6"
      end = formatDate(year, endPart1, endPart2);
    }
    return { start, end };
  }

  // Pattern: "~2026/1/13" or "-2026/1/13"
  const endOnly = trimmed.match(/[~\-至](\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (endOnly) {
    return { start: null, end: formatDate(endOnly[1], endOnly[2], endOnly[3]) };
  }

  // Pattern: "2026/1/5~" (start only, no end)
  const startOnly = trimmed.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})[~\-至]$/);
  if (startOnly) {
    return { start: formatDate(startOnly[1], startOnly[2], startOnly[3]), end: null };
  }

  return { start: null, end: null };
}

function formatDate(year: string, month: string, day: string): string {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// ── Deal Type Normalization ──

export interface NormalizedDeal {
  category: DealCategory;
  display: string;
}

const DEAL_PATTERNS: { pattern: RegExp; category: DealCategory }[] = [
  { pattern: /買[一1]送[一1]/, category: 'bogo' },
  { pattern: /買\s*(\d+|[兩二三四五六七八九十])\s*送\s*(\d+|[兩二三四五六七八九十])/, category: 'buy_n_get_m' },
  { pattern: /第\s*[二2]\s*杯/, category: 'discount' },
  { pattern: /第[二2]杯半價/, category: 'discount' },
  { pattern: /\d+折$/, category: 'discount' },
  { pattern: /^\d+元$/, category: 'fixed_price' },
  { pattern: /\d+杯\d+元/, category: 'bundle' },
];

export function normalizeDealType(raw: string): NormalizedDeal {
  if (!raw) return { category: 'other', display: raw };

  const cleaned = raw.trim();

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

  // cpok.tw tables typically have 3 columns: 優惠項目 | 優惠價 | 活動時間
  // Some tables may have 2 columns (missing date)
  const product_name = row[0]?.trim();
  const deal_type = row[1]?.trim();
  const date_range = row[2]?.trim() || '';

  if (!product_name || !deal_type) return null;

  // Skip menu items (prices like "35元" without deal keywords)
  if (/^\d+元$/.test(deal_type) && !product_name.includes('買')) return null;

  const { category, display } = normalizeDealType(deal_type);
  const { start, end } = parseDateRange(date_range);

  return {
    product_name,
    deal_type: display,
    deal_category: category,
    start_date: start,
    end_date: end,
  };
}
