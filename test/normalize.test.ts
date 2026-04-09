import { describe, it, expect } from 'vitest';
import {
  parseDateRange,
  normalizeDealType,
  normalizeRow,
  classifyProduct,
  getTodayTaiwan,
  PRODUCT_CATEGORY_LABELS,
} from '../src/lib/normalize';

describe('parseDateRange', () => {
  it('parses full range with same year shorthand', () => {
    const result = parseDateRange('2026/1/5~2/6');
    expect(result).toEqual({ start: '2026-01-05', end: '2026-02-06' });
  });

  it('parses full range with full year on both sides', () => {
    const result = parseDateRange('2026/1/5~2026/2/6');
    expect(result).toEqual({ start: '2026-01-05', end: '2026-02-06' });
  });

  it('parses end-only range', () => {
    const result = parseDateRange('~2026/1/13');
    expect(result).toEqual({ start: null, end: '2026-01-13' });
  });

  it('parses start-only range', () => {
    const result = parseDateRange('2026/1/5~');
    expect(result).toEqual({ start: '2026-01-05', end: null });
  });

  it('returns nulls for unparseable text', () => {
    const result = parseDateRange('到公告截止');
    expect(result).toEqual({ start: null, end: null });
  });

  it('returns nulls for empty string', () => {
    const result = parseDateRange('');
    expect(result).toEqual({ start: null, end: null });
  });

  it('pads single-digit months and days', () => {
    const result = parseDateRange('2026/3/9~4/1');
    expect(result).toEqual({ start: '2026-03-09', end: '2026-04-01' });
  });

  it('handles dash separator', () => {
    const result = parseDateRange('2026/1/5-2/6');
    expect(result).toEqual({ start: '2026-01-05', end: '2026-02-06' });
  });

  it('handles 至 separator', () => {
    const result = parseDateRange('2026/1/5至2/6');
    expect(result).toEqual({ start: '2026-01-05', end: '2026-02-06' });
  });

  it('handles whitespace in input', () => {
    const result = parseDateRange(' 2026/1/5 ~ 2/6 ');
    expect(result).toEqual({ start: '2026-01-05', end: '2026-02-06' });
  });
});

describe('normalizeDealType', () => {
  it('identifies 買一送一 as bogo', () => {
    expect(normalizeDealType('買一送一')).toEqual({ category: 'bogo', display: '買一送一' });
  });

  it('identifies 買1送1 as bogo', () => {
    expect(normalizeDealType('買1送1')).toEqual({ category: 'bogo', display: '買1送1' });
  });

  it('identifies 買2送2 as buy_n_get_m', () => {
    expect(normalizeDealType('買2送2')).toEqual({ category: 'buy_n_get_m', display: '買2送2' });
  });

  it('identifies 買兩送二 as buy_n_get_m', () => {
    expect(normalizeDealType('買兩送二')).toEqual({ category: 'buy_n_get_m', display: '買兩送二' });
  });

  it('identifies 第2杯10元 as discount', () => {
    expect(normalizeDealType('第2杯10元')).toEqual({ category: 'discount', display: '第2杯10元' });
  });

  it('identifies 第2杯半價 as discount', () => {
    expect(normalizeDealType('第2杯半價')).toEqual({ category: 'discount', display: '第2杯半價' });
  });

  it('identifies 79折 as discount', () => {
    expect(normalizeDealType('79折')).toEqual({ category: 'discount', display: '79折' });
  });

  it('identifies 45元 as fixed_price', () => {
    expect(normalizeDealType('45元')).toEqual({ category: 'fixed_price', display: '45元' });
  });

  it('identifies 2杯79元 as bundle', () => {
    expect(normalizeDealType('2杯79元')).toEqual({ category: 'bundle', display: '2杯79元' });
  });

  it('returns other for unknown types', () => {
    expect(normalizeDealType('加購價')).toEqual({ category: 'other', display: '加購價' });
  });

  it('returns other for empty string', () => {
    expect(normalizeDealType('')).toEqual({ category: 'other', display: '' });
  });
});

describe('normalizeRow', () => {
  it('normalizes a 3-column row', () => {
    const result = normalizeRow(['特大冰濃萃美式咖啡', '買一送一', '2026/1/5~2/6'], '7-11');
    expect(result).toEqual({
      product_name: '特大冰濃萃美式咖啡',
      deal_type: '買一送一',
      deal_category: 'bogo',
      start_date: '2026-01-05',
      end_date: '2026-02-06',
    });
  });

  it('normalizes a 2-column row without date', () => {
    const result = normalizeRow(['大杯精品美式', '買2送2'], 'familymart');
    expect(result).toEqual({
      product_name: '大杯精品美式',
      deal_type: '買2送2',
      deal_category: 'buy_n_get_m',
      start_date: null,
      end_date: null,
    });
  });

  it('returns null for row with less than 2 columns', () => {
    expect(normalizeRow(['only one'], '7-11')).toBeNull();
  });

  it('returns null when product_name is empty', () => {
    expect(normalizeRow(['', '買一送一', '2026/1/5~2/6'], '7-11')).toBeNull();
  });

  it('returns null when deal_type is empty', () => {
    expect(normalizeRow(['美式咖啡', '', '2026/1/5~2/6'], '7-11')).toBeNull();
  });

  it('skips plain price items without deal keywords', () => {
    expect(normalizeRow(['美式咖啡', '35元'], '7-11')).toBeNull();
  });
});

describe('classifyProduct', () => {
  it('classifies coffee products', () => {
    expect(classifyProduct('特大冰濃萃美式咖啡')).toBe('coffee');
    expect(classifyProduct('大杯拿鐵')).toBe('coffee');
    expect(classifyProduct('CITY CAFE')).toBe('coffee');
  });

  it('classifies tea products', () => {
    expect(classifyProduct('錫蘭紅茶')).toBe('tea');
    expect(classifyProduct('茉莉綠茶')).toBe('tea');
  });

  it('classifies milk products', () => {
    expect(classifyProduct('鮮乳')).toBe('milk');
    expect(classifyProduct('豆漿')).toBe('milk');
  });

  it('classifies juice/drink products', () => {
    expect(classifyProduct('蘋果汁')).toBe('juice');
    expect(classifyProduct('氣泡水')).toBe('juice');
  });

  it('classifies bread products', () => {
    expect(classifyProduct('吐司')).toBe('bread');
    expect(classifyProduct('三明治')).toBe('bread');
  });

  it('classifies dessert products', () => {
    expect(classifyProduct('巧克力蛋糕')).toBe('dessert');
    expect(classifyProduct('霜淇淋')).toBe('dessert');
  });

  it('returns other for unknown products', () => {
    expect(classifyProduct('某某商品')).toBe('other');
  });

  it('returns other for empty string', () => {
    expect(classifyProduct('')).toBe('other');
  });
});

describe('PRODUCT_CATEGORY_LABELS', () => {
  it('has labels for all categories', () => {
    expect(PRODUCT_CATEGORY_LABELS.coffee).toBe('咖啡');
    expect(PRODUCT_CATEGORY_LABELS.tea).toBe('茶飲');
    expect(PRODUCT_CATEGORY_LABELS.other).toBe('其他');
  });
});

describe('getTodayTaiwan', () => {
  it('returns a date string in YYYY-MM-DD format', () => {
    const result = getTodayTaiwan();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
