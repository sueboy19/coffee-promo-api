import { DB } from '../lib/db';
import { parsePromotionTables } from '../lib/parser';
import { normalizeRow, getTodayTaiwan } from '../lib/normalize';
import type { StoreBrand, ScrapeResult } from '../types';

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

export class ScraperService {
  private db: DB;

  constructor(private env: Env) {
    this.db = new DB(env.DB);
  }

  async scrapeAll(brands?: StoreBrand[]): Promise<ScrapeResult[]> {
    const allBrands: StoreBrand[] = ['7-11', 'familymart'];
    const targetBrands = brands?.length ? brands.filter(b => allBrands.includes(b)) : allBrands;

    const settled = await Promise.allSettled(
      targetBrands.map(brand => this.scrapeBrand(brand))
    );

    const results: ScrapeResult[] = [];
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push({
          brand: '7-11',
          itemsFound: 0,
          itemsAdded: 0,
          itemsUpdated: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }

    await this.updateExpiredStatuses();

    return results;
  }

  async scrapeBrand(brand: StoreBrand): Promise<ScrapeResult> {
    const url = brand === '7-11'
      ? this.env.CPOK_711_URL
      : this.env.CPOK_FAMILYMART_URL;

    if (!url) {
      return { brand, itemsFound: 0, itemsAdded: 0, itemsUpdated: 0, error: `No URL configured for ${brand}` };
    }

    const logId = await this.db.createScrapeLog(`cpok-${brand}`, url);

    try {
      const response = await this.fetchWithRetry(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      const rawRows = await parsePromotionTables(response);

      const normalized = rawRows
        .map(row => normalizeRow(row, brand))
        .filter((p): p is NonNullable<typeof p> => p !== null);

      let itemsAdded = 0;
      const activeIds: number[] = [];

      for (const promo of normalized) {
        const { id, added } = await this.db.upsertPromotion({
          store_brand: brand,
          product_name: promo.product_name,
          deal_type: promo.deal_type,
          deal_category: promo.deal_category,
          start_date: promo.start_date,
          end_date: promo.end_date,
          source: 'cpok',
          source_url: url,
        });
        if (added) itemsAdded++;
        activeIds.push(id);
      }

      const itemsUpdated = activeIds.length > 0
        ? await this.db.markExpiredPromotions(activeIds, brand)
        : 0;

      await this.db.completeScrapeLog(logId, 'success', normalized.length, itemsAdded, itemsUpdated);

      return {
        brand,
        itemsFound: normalized.length,
        itemsAdded,
        itemsUpdated,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.db.completeScrapeLog(logId, 'failed', 0, 0, 0, errorMsg);

      return {
        brand,
        itemsFound: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        error: errorMsg,
      };
    }
  }

  private async fetchWithRetry(url: string, retries: number = MAX_RETRIES): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'CoffeePromoAPI/1.0',
            'Accept': 'text/html',
          },
          signal: AbortSignal.timeout(15000),
        });
        return response;
      } catch (err) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Fetch failed after ${retries + 1} attempts: ${url}`);
  }

  private async updateExpiredStatuses(): Promise<void> {
    const today = getTodayTaiwan();
    await this.db.d1
      .prepare(
        `UPDATE promotions SET status = 'expired', updated_at = datetime('now')
         WHERE status = 'active' AND end_date IS NOT NULL AND end_date < ?`
      )
      .bind(today)
      .run();
  }
}
