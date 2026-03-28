import type {
  Promotion,
  ScrapeLog,
  PromotionQuery,
  StoreBrand,
  DealCategory,
  PromotionStatus,
  ScrapeLogStatus,
} from '../types';

export class DB {
  /** Exposed for direct SQL access when needed */
  public readonly d1: D1Database;

  constructor(d1: D1Database) {
    this.d1 = d1;
  }

  // ── Promotion CRUD ──

  async createPromotion(p: {
    store_brand: StoreBrand;
    product_name: string;
    deal_type: string;
    deal_category: DealCategory;
    start_date: string | null;
    end_date: string | null;
    status: PromotionStatus;
    source: string;
    is_recurring?: number;
    recurring_pattern?: string | null;
    source_url?: string | null;
  }): Promise<Promotion> {
    const result = await this.d1
      .prepare(
        `INSERT INTO promotions (store_brand, product_name, deal_type, deal_category, start_date, end_date, status, source, is_recurring, recurring_pattern, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        p.store_brand, p.product_name, p.deal_type, p.deal_category,
        p.start_date, p.end_date, p.status, p.source,
        p.is_recurring ?? 0, p.recurring_pattern ?? null, p.source_url ?? null
      )
      .run();

    const created = await this.getPromotionById(result.meta.last_row_id);
    if (!created) throw new Error('Failed to create promotion');
    return created;
  }

  async getPromotionById(id: number): Promise<Promotion | null> {
    return this.d1.prepare('SELECT * FROM promotions WHERE id = ?').bind(id).first<Promotion>();
  }

  async listPromotions(query: PromotionQuery = {}): Promise<{ data: Promotion[]; total: number }> {
    const conditions: string[] = [];
    const values: any[] = [];

    if (query.brand) {
      conditions.push('store_brand = ?');
      values.push(query.brand);
    }
    if (query.status) {
      conditions.push('status = ?');
      values.push(query.status);
    }
    if (query.deal_category) {
      conditions.push('deal_category = ?');
      values.push(query.deal_category);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.min(query.limit || 50, 100);
    const offset = query.offset || 0;

    const countResult = await this.d1
      .prepare(`SELECT COUNT(*) as total FROM promotions ${where}`)
      .bind(...values)
      .first<{ total: number }>();

    const result = await this.d1
      .prepare(`SELECT * FROM promotions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset)
      .all<Promotion>();

    return { data: result.results || [], total: countResult?.total || 0 };
  }

  async listActivePromotions(brand?: StoreBrand): Promise<Promotion[]> {
    const today = new Date().toISOString().slice(0, 10);
    let sql = `SELECT * FROM promotions WHERE status = 'active' AND (end_date IS NULL OR end_date >= ?)`;
    const values: any[] = [today];

    if (brand) {
      sql += ` AND store_brand = ?`;
      values.push(brand);
    }

    sql += ` ORDER BY store_brand, start_date DESC`;
    const result = await this.d1.prepare(sql).bind(...values).all<Promotion>();
    return result.results || [];
  }

  async updatePromotion(id: number, updates: Partial<Pick<Promotion, 'deal_type' | 'deal_category' | 'start_date' | 'end_date' | 'status' | 'source_url'>>): Promise<Promotion | null> {
    const setClauses: string[] = ['updated_at = datetime(\'now\')'];
    const values: any[] = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      values.push(value ?? null);
    }

    await this.d1
      .prepare(`UPDATE promotions SET ${setClauses.join(', ')} WHERE id = ?`)
      .bind(...values, id)
      .run();

    return this.getPromotionById(id);
  }

  async deletePromotion(id: number): Promise<boolean> {
    const result = await this.d1.prepare('DELETE FROM promotions WHERE id = ?').bind(id).run();
    return (result.meta.changes || 0) > 0;
  }

  async deleteExpiredPromotions(olderThanDays: number = 30): Promise<number> {
    const result = await this.d1
      .prepare(`DELETE FROM promotions WHERE status = 'expired' AND end_date < date('now', '-' || ? || ' days')`)
      .bind(olderThanDays)
      .run();
    return result.meta.changes || 0;
  }

  // ── Dedup / Upsert ──

  async findExistingPromotion(brand: StoreBrand, productName: string, startDate: string | null, endDate: string | null): Promise<Promotion | null> {
    return this.d1
      .prepare(`SELECT * FROM promotions WHERE store_brand = ? AND product_name = ? AND start_date IS ? AND end_date IS ? AND status != 'expired'`)
      .bind(brand, productName, startDate, endDate)
      .first<Promotion>();
  }

  async upsertPromotion(p: {
    store_brand: StoreBrand;
    product_name: string;
    deal_type: string;
    deal_category: DealCategory;
    start_date: string | null;
    end_date: string | null;
    source: string;
    source_url?: string;
  }): Promise<{ id: number; added: boolean }> {
    const existing = await this.findExistingPromotion(p.store_brand, p.product_name, p.start_date, p.end_date);

    if (existing) {
      if (existing.deal_type !== p.deal_type || existing.deal_category !== p.deal_category) {
        await this.updatePromotion(existing.id, {
          deal_type: p.deal_type,
          deal_category: p.deal_category,
          start_date: p.start_date,
          end_date: p.end_date,
          status: 'active',
        });
      }
      await this.d1
        .prepare('UPDATE promotions SET scraped_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?')
        .bind(existing.id)
        .run();
      return { id: existing.id, added: false };
    }

    const created = await this.createPromotion({
      store_brand: p.store_brand,
      product_name: p.product_name,
      deal_type: p.deal_type,
      deal_category: p.deal_category,
      start_date: p.start_date,
      end_date: p.end_date,
      status: 'active',
      source: p.source,
      source_url: p.source_url,
    });
    return { id: created.id, added: true };
  }

  // ── Mark stale promotions as expired ──

  async markExpiredPromotions(activeIds: number[], brand: StoreBrand): Promise<number> {
    if (activeIds.length === 0) return 0;

    const today = new Date().toISOString().slice(0, 10);
    const placeholders = activeIds.map(() => '?').join(',');
    const result = await this.d1
      .prepare(
        `UPDATE promotions SET status = 'expired', updated_at = datetime('now')
         WHERE store_brand = ? AND status = 'active' AND id NOT IN (${placeholders}) AND end_date IS NOT NULL AND end_date < ?`
      )
      .bind(brand, ...activeIds, today)
      .run();
    return result.meta.changes || 0;
  }

  // ── Scrape Logs ──

  async createScrapeLog(source: string, url: string): Promise<number> {
    const result = await this.d1
      .prepare(`INSERT INTO scrape_logs (source, url, status, items_found, started_at) VALUES (?, ?, 'partial', 0, datetime('now'))`)
      .bind(source, url)
      .run();
    return result.meta.last_row_id;
  }

  async completeScrapeLog(
    id: number,
    status: ScrapeLogStatus,
    itemsFound: number,
    itemsAdded: number,
    itemsUpdated: number,
    errorMessage?: string
  ): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE scrape_logs SET status = ?, items_found = ?, items_added = ?, items_updated = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?`
      )
      .bind(status, itemsFound, itemsAdded, itemsUpdated, errorMessage || null, id)
      .run();
  }

  async getLatestScrapeLog(source: string): Promise<ScrapeLog | null> {
    return this.d1
      .prepare(`SELECT * FROM scrape_logs WHERE source = ? ORDER BY started_at DESC LIMIT 1`)
      .bind(source)
      .first<ScrapeLog>();
  }
}
