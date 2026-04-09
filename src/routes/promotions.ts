import { Hono } from 'hono';
import { DB } from '../lib/db';
import { classifyProduct, PRODUCT_CATEGORY_LABELS } from '../lib/normalize';
import type { Promotion, PromotionStatus, ProductCategory, StoreBrand, DealCategory } from '../types';

const VALID_BRANDS: readonly string[] = ['7-11', 'familymart'];
const VALID_STATUSES: readonly string[] = ['upcoming', 'active', 'expired'];
const VALID_DEAL_CATEGORIES: readonly string[] = ['bogo', 'buy_n_get_m', 'discount', 'fixed_price', 'bundle', 'other'];
const CACHE_KEY_PREFIX = 'coffee-promo-api:active';
const CACHE_TTL = 300;

const router = new Hono<{ Bindings: Env }>();

// ── Helpers ──

interface PromotionItem extends Promotion {
  product_category: ProductCategory;
}

interface GroupedPromotions {
  [storeBrand: string]: {
    [productCategory: string]: {
      label: string;
      items: PromotionItem[];
    };
  };
}

function groupPromotions(promotions: Promotion[]): GroupedPromotions {
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

function validateEnum(value: string | undefined, valid: readonly string[], fieldName: string): string | undefined {
  if (!value) return undefined;
  if (!valid.includes(value)) {
    throw new Error(`Invalid ${fieldName}: '${value}'. Valid values: ${valid.join(', ')}`);
  }
  return value;
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
  try {
    const brand = validateEnum(c.req.query('brand'), VALID_BRANDS, 'brand') as StoreBrand | undefined;
    const status = (validateEnum(c.req.query('status'), VALID_STATUSES, 'status') || 'active') as PromotionStatus;
    const dealCategory = validateEnum(c.req.query('deal_category'), VALID_DEAL_CATEGORIES, 'deal_category') as DealCategory | undefined;
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50') || 50, 100));
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0') || 0);

    const db = new DB(c.env.DB);
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
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid ')) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

// ── Active promotions (with cache) ──

router.get('/promotions/active', async (c) => {
  try {
    const brand = validateEnum(c.req.query('brand'), VALID_BRANDS, 'brand') as StoreBrand | undefined;

    const cacheKey = `${CACHE_KEY_PREFIX}:${brand || 'all'}`;
    const cache = caches.default;
    const cachedResponse = await cache.match(new Request(new URL(cacheKey, c.req.url)));

    if (cachedResponse) {
      return new Response(cachedResponse.body, cachedResponse);
    }

    const db = new DB(c.env.DB);
    const promotions = await db.listActivePromotions(brand);
    const grouped = groupPromotions(promotions);

    const body = JSON.stringify({
      data: grouped,
      total: promotions.length,
    });

    const response = new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
        'X-Cache': 'MISS',
      },
    });

    c.executionCtx.waitUntil(
      cache.put(new Request(new URL(cacheKey, c.req.url)), response.clone())
    );

    return response;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid ')) {
      return c.json({ error: err.message }, 400);
    }
    throw err;
  }
});

// ── Single promotion ──

router.get('/promotions/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) {
    return c.json({ error: 'Invalid ID' }, 400);
  }

  const db = new DB(c.env.DB);
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
    const [latestLog, latestFamilymartLog, countResult] = await Promise.all([
      db.getLatestScrapeLog('cpok-7-11'),
      db.getLatestScrapeLog('cpok-familymart'),
      db.d1
        .prepare('SELECT COUNT(*) as total FROM promotions WHERE status = ?')
        .bind('active')
        .first<{ total: number }>(),
    ]);

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
