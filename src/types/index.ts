export type StoreBrand = '7-11' | 'familymart';
export type DealCategory = 'bogo' | 'buy_n_get_m' | 'discount' | 'fixed_price' | 'bundle' | 'other';
export type PromotionStatus = 'upcoming' | 'active' | 'expired';
export type ScrapeSource = 'cpok' | 'recurring' | 'manual';
export type ScrapeLogStatus = 'success' | 'partial' | 'failed';

export interface Promotion {
  id: number;
  store_brand: StoreBrand;
  product_name: string;
  deal_type: string;
  deal_category: DealCategory;
  start_date: string | null;
  end_date: string | null;
  status: PromotionStatus;
  source: ScrapeSource;
  is_recurring: number;
  recurring_pattern: string | null;
  source_url: string | null;
  scraped_at: string;
  created_at: string;
  updated_at: string;
}

export interface ScrapeLog {
  id: number;
  source: string;
  url: string;
  status: ScrapeLogStatus;
  items_found: number;
  items_added: number;
  items_updated: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface PromotionQuery {
  brand?: StoreBrand;
  status?: PromotionStatus;
  deal_category?: DealCategory;
  limit?: number;
  offset?: number;
}

export interface ScrapeResult {
  brand: StoreBrand;
  itemsFound: number;
  itemsAdded: number;
  itemsUpdated: number;
  error?: string;
}
