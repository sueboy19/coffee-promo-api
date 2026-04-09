import { DB } from '../lib/db';
import type { StoreBrand, DealCategory } from '../types';

interface RecurringRule {
  brand: StoreBrand;
  product_name: string;
  deal_type: string;
  deal_category: DealCategory;
  pattern: string;
  dayMatch: (d: Date) => boolean;
  startOffset: number;
  endOffset: number;
}

const RECURRING_RULES: RecurringRule[] = [
  {
    brand: 'familymart',
    product_name: 'Let\'s Café 咖啡 週一咖啡日',
    deal_type: '第2杯10元',
    deal_category: 'discount',
    pattern: 'monday-coffee',
    dayMatch: (d) => d.getDay() === 1,
    startOffset: 0,
    endOffset: 0,
  },
  {
    brand: 'familymart',
    product_name: 'Let\'s Café 咖啡 每月6號好咖日',
    deal_type: '買6送6',
    deal_category: 'buy_n_get_m',
    pattern: 'monthly-6-coffee',
    dayMatch: (d) => d.getDate() === 6,
    startOffset: 0,
    endOffset: 0,
  },
];

function formatDateTaiwan(d: Date): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

export async function generateRecurringPromotions(db: DB): Promise<{ added: number; updated: number }> {
  const now = new Date();
  const taiwanNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));

  let added = 0;
  let updated = 0;

  for (const rule of RECURRING_RULES) {
    if (!rule.dayMatch(taiwanNow)) continue;

    const today = formatDateTaiwan(now);
    const start = formatDateTaiwan(new Date(now.getTime() + rule.startOffset * 86400000));
    const end = formatDateTaiwan(new Date(now.getTime() + rule.endOffset * 86400000));

    const result = await db.upsertRecurringPromotion({
      store_brand: rule.brand,
      product_name: rule.product_name,
      deal_type: rule.deal_type,
      deal_category: rule.deal_category,
      start_date: start,
      end_date: end === start ? null : end,
      recurring_pattern: rule.pattern,
      source: 'recurring',
    });

    if (result.added) added++;
    else updated++;
  }

  return { added, updated };
}
