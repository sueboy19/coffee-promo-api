import { DB } from '../lib/db';
import { parsePromotionTables } from '../lib/parser';
import { normalizeRow } from '../lib/normalize';
import type { StoreBrand, ScrapeResult } from '../types';

export class ScraperService {
  private db: DB;

  constructor(private env: Env) {
    this.db = new DB(env.DB);
  }

  async scrapeAll(): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];
    const brands: StoreBrand[] = ['7-11', 'familymart'];

    for (const brand of brands) {
      const result = await this.scrapeBrand(brand);
      results.push(result);
    }

    // Update expired promotions
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
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'CoffeePromoAPI/1.0',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      // Parse HTML tables
      const rawRows = await parsePromotionTables(response);

      // Normalize rows into structured promotions
      const normalized = rawRows
        .map(row => normalizeRow(row, brand))
        .filter((p): p is NonNullable<typeof p> => p !== null);

      // Upsert into database
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

      // Mark stale promotions as expired
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

  private async updateExpiredStatuses(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await this.db.d1
      .prepare(
        `UPDATE promotions SET status = 'expired', updated_at = datetime('now')
         WHERE status = 'active' AND end_date IS NOT NULL AND end_date < ?`
      )
      .bind(today)
      .run();
  }
}
