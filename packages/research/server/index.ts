import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { analyticsRoutes } from './routes/analytics.js';

const app = new Hono();

app.get('/api/health', (c) => {
  return c.json({ status: 'ok' });
});

// Mount analytics routes
app.route('/', analyticsRoutes);

const PORT = parseInt(process.env.RESEARCH_PORT ?? '3002', 10);

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Research server running at http://localhost:${info.port}`);
});

export { app };
