import type { DealCategory, ProductCategory } from '../types';

// ── Taiwan timezone helper ──

export function getTodayTaiwan(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

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
