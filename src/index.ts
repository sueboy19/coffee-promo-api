import { Hono } from 'hono';
import { cors } from 'hono/cors';
import promotionRoutes from './routes/promotions';
import adminRoutes from './routes/admin';
import { ScraperService } from './services/scraper';
import { generateRecurringPromotions } from './services/recurring';
import { DB } from './lib/db';

const app = new Hono<{ Bindings: Env }>();

// ── CORS ──

app.use('*', cors({
  origin: (origin, c) => {
    const allowed = c.env.CORS_ORIGINS.split(',');
    return allowed.includes(origin) ? origin : allowed[0];
  },
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-API-Key'],
}));

// ── Error handler ──

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

// ── Routes ──

app.route('/', promotionRoutes);
app.route('/', adminRoutes);

// ── Cron handler (daily at UTC 6:00 = Taiwan 14:00) ──

const scheduled = async (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
  console.log('[scheduled] Starting scheduled scrape at', new Date().toISOString());

  const scraper = new ScraperService(env);

  try {
    const results = await scraper.scrapeAll();

    for (const result of results) {
      console.log(
        `[scheduled] ${result.brand}: found=${result.itemsFound}, added=${result.itemsAdded}, updated=${result.itemsUpdated}`,
        result.error ? `, error=${result.error}` : ''
      );
    }

    ctx.waitUntil(purgeActiveCache(env));
    ctx.waitUntil(cleanOldLogs(env));
    ctx.waitUntil(handleRecurring(env));

    console.log('[scheduled] Scrape completed successfully');
  } catch (err) {
    console.error('[scheduled] Scrape failed:', err);
  }
};

async function purgeActiveCache(env: Env): Promise<void> {
  try {
    const cache = caches.default;
    const baseUrl = `https://${env.ENVIRONMENT === 'production' ? 'coffee-promo-api-prod.ffbizs.com' : 'localhost:8788'}`;
    await Promise.all([
      cache.delete(new Request(new URL('coffee-promo-api:active:all', baseUrl))),
      cache.delete(new Request(new URL('coffee-promo-api:active:7-11', baseUrl))),
      cache.delete(new Request(new URL('coffee-promo-api:active:familymart', baseUrl))),
    ]);
  } catch {
    // Cache purge failure is non-critical
  }
}

async function cleanOldLogs(env: Env): Promise<void> {
  try {
    const db = new DB(env.DB);
    const deleted = await db.deleteOldScrapeLogs(90);
    if (deleted > 0) {
      console.log(`[scheduled] Cleaned ${deleted} old scrape logs`);
    }
  } catch {
    // Log cleanup failure is non-critical
  }
}

async function handleRecurring(env: Env): Promise<void> {
  try {
    const db = new DB(env.DB);
    const result = await generateRecurringPromotions(db);
    if (result.added > 0 || result.updated > 0) {
      console.log(`[scheduled] Recurring: added=${result.added}, updated=${result.updated}`);
    }
  } catch (err) {
    console.error('[scheduled] Recurring generation failed:', err);
  }
}

// ── Export handlers ──

export default {
  fetch: app.fetch.bind(app),
  scheduled,
};
