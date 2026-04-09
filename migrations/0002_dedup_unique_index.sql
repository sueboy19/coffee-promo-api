CREATE UNIQUE INDEX IF NOT EXISTS idx_promotions_dedup
  ON promotions(store_brand, product_name, start_date, end_date);
