import { Hono } from 'hono';
import { ScraperService } from '../services/scraper';
import { DB } from '../lib/db';
import type { StoreBrand } from '../types';

const router = new Hono<{ Bindings: Env }>();

// ── API Key auth middleware ──

router.use('*', async (c, next) => {
  const apiKey = c.req.header('X-API-Key');
  if (!apiKey || apiKey !== c.env.API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});

// ── Trigger manual scrape ──

router.post('/scrape', async (c) => {
  const scraper = new ScraperService(c.env);
  const body = await c.req.json().catch(() => ({}));
  const requestedBrands = (body.brands as string[] | undefined)?.filter(Boolean) as StoreBrand[] | undefined;

  const results = await scraper.scrapeAll(requestedBrands);

  return c.json({
    data: results,
    timestamp: new Date().toISOString(),
  });
});

// ── Delete expired promotions ──

router.delete('/promotions/expired', async (c) => {
  const db = new DB(c.env.DB);
  const olderThanDays = Math.max(1, Math.min(parseInt(c.req.query('older_than_days') || '30') || 30, 365));
  const deleted = await db.deleteExpiredPromotions(olderThanDays);
  return c.json({ deleted });
});

export default router;
