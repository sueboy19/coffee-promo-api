import { Hono } from 'hono';
import { DB } from '../lib/db';
import { classifyProduct, PRODUCT_CATEGORY_LABELS } from '../lib/normalize';
import type { PromotionStatus, ProductCategory } from '../types';

const router = new Hono<{ Bindings: Env }>();

// ── Helpers ──

interface GroupedPromotions {
  [storeBrand: string]: {
    [productCategory: string]: {
      label: string;
      items: any[];
    };
  };
}

function groupPromotions(promotions: any[]): GroupedPromotions {
  const grouped: GroupedPromotions = {};

  for (const promo of promotions) {
    const store = promo.store_brand;
    const pCategory: ProductCategory = classifyProduct(promo.product_name);

    if (!grouped[store]) grouped[store] = {};
    if (!grouped[store][pCategory]) {
      grouped[store][pCategory] = {
        label: PRODUCT_CATEGORY_LABELS[pCategory],
        items: [],
      };
    }

    grouped[store][pCategory].items.push({
      ...promo,
      product_category: pCategory,
    });
  }

  return grouped;
}

// ── Health check ──

router.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'coffee-promo-api',
    timestamp: new Date().toISOString(),
  });
});

// ── List promotions (grouped by store & product category) ──

router.get('/promotions', async (c) => {
  const db = new DB(c.env.DB);

  const brand = c.req.query('brand') as any;
  const status = (c.req.query('status') || 'active') as PromotionStatus;
  const dealCategory = c.req.query('deal_category') as any;
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50') || 50, 100));
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0') || 0);

  const result = await db.listPromotions({
    brand,
    status,
    deal_category: dealCategory,
    limit,
    offset,
  });

  const grouped = groupPromotions(result.data);

  return c.json({
    data: grouped,
    total: result.total,
    limit,
    offset,
  });
});

// ── Active promotions (grouped by store & product category) ──

router.get('/promotions/active', async (c) => {
  const db = new DB(c.env.DB);
  const brand = c.req.query('brand') as any;
  const promotions = await db.listActivePromotions(brand);
  const grouped = groupPromotions(promotions);

  return c.json({
    data: grouped,
    total: promotions.length,
  });
});

// ── Single promotion ──

router.get('/promotions/:id', async (c) => {
  const db = new DB(c.env.DB);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }
  const promotion = await db.getPromotionById(id);

  if (!promotion) {
    return c.json({ error: 'Promotion not found' }, 404);
  }

  const pCategory = classifyProduct(promotion.product_name);

  return c.json({
    data: {
      ...promotion,
      product_category: pCategory,
      product_category_label: PRODUCT_CATEGORY_LABELS[pCategory],
    },
  });
});

// ── Health with DB info ──

router.get('/health', async (c) => {
  const db = new DB(c.env.DB);

  try {
    const latestLog = await db.getLatestScrapeLog('cpok-7-11');
    const latestFamilymartLog = await db.getLatestScrapeLog('cpok-familymart');

    const countResult = await db.d1
      .prepare('SELECT COUNT(*) as total FROM promotions WHERE status = ?')
      .bind('active')
      .first<{ total: number }>();

    return c.json({
      status: 'ok',
      db: 'connected',
      active_promotions: countResult?.total || 0,
      last_scrape: {
        '7-11': latestLog ? { status: latestLog.status, time: latestLog.started_at } : null,
        familymart: latestFamilymartLog ? { status: latestFamilymartLog.status, time: latestFamilymartLog.started_at } : null,
      },
    });
  } catch (err) {
    console.error('Health check DB error:', err);
    return c.json({ status: 'error', db: 'disconnected' }, 500);
  }
});

export default router;
