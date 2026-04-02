import { Hono } from 'hono';
import { cors } from 'hono/cors';
import promotionRoutes from './routes/promotions';
import adminRoutes from './routes/admin';
import { ScraperService } from './services/scraper';

const app = new Hono<{ Bindings: Env }>();

// ── CORS ──

app.use('*', cors({
  origin: (origin) => origin, // Reflect origin
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

    console.log('[scheduled] Scrape completed successfully');
  } catch (err) {
    console.error('[scheduled] Scrape failed:', err);
  }
};

// ── Export handlers ──

export default {
  fetch: app.fetch.bind(app),
  scheduled,
};
