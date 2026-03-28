import { Hono } from 'hono';
import { DB } from '../lib/db';
import type { PromotionStatus } from '../types';

const router = new Hono<{ Bindings: Env }>();

// ── Health check ──

router.get('/', (c) => {
  return c.json({
    status: 'ok',
    service: 'coffee-promo-api',
    timestamp: new Date().toISOString(),
  });
});

// ── List promotions ──

router.get('/promotions', async (c) => {
  const db = new DB(c.env.DB);

  const brand = c.req.query('brand') as any;
  const status = (c.req.query('status') || 'active') as PromotionStatus;
  const dealCategory = c.req.query('deal_category') as any;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const result = await db.listPromotions({
    brand,
    status,
    deal_category: dealCategory,
    limit,
    offset,
  });

  return c.json({
    data: result.data,
    total: result.total,
    limit,
    offset,
  });
});

// ── Active promotions (shortcut) ──

router.get('/promotions/active', async (c) => {
  const db = new DB(c.env.DB);
  const brand = c.req.query('brand') as any;
  const promotions = await db.listActivePromotions(brand);
  return c.json({ data: promotions, total: promotions.length });
});

// ── Single promotion ──

router.get('/promotions/:id', async (c) => {
  const db = new DB(c.env.DB);
  const id = parseInt(c.req.param('id'));
  const promotion = await db.getPromotionById(id);

  if (!promotion) {
    return c.json({ error: 'Promotion not found' }, 404);
  }

  return c.json({ data: promotion });
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
    return c.json({ status: 'error', db: 'disconnected', error: String(err) }, 500);
  }
});

export default router;
