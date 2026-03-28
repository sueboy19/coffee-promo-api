-- Coffee promotion tracking
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_brand TEXT NOT NULL CHECK(store_brand IN ('7-11', 'familymart')),
  product_name TEXT NOT NULL,
  deal_type TEXT NOT NULL,
  deal_category TEXT NOT NULL CHECK(deal_category IN ('bogo', 'buy_n_get_m', 'discount', 'fixed_price', 'bundle', 'other')),
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('upcoming', 'active', 'expired')),
  source TEXT NOT NULL DEFAULT 'cpok' CHECK(source IN ('cpok', 'recurring', 'manual')),
  is_recurring INTEGER DEFAULT 0,
  recurring_pattern TEXT,
  source_url TEXT,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Scrape execution logs
CREATE TABLE IF NOT EXISTS scrape_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'partial' CHECK(status IN ('success', 'partial', 'failed')),
  items_found INTEGER DEFAULT 0,
  items_added INTEGER DEFAULT 0,
  items_updated INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_promotions_brand_status ON promotions(store_brand, status);
CREATE INDEX IF NOT EXISTS idx_promotions_dates ON promotions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promotions_category ON promotions(deal_category);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_source ON scrape_logs(source, started_at DESC);
