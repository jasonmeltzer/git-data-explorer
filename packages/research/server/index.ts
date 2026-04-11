import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import importRoutes from './routes/import.js';
import orgRoutes from './routes/orgs.js';
import { analyticsRoutes } from './routes/analytics.js';

const app = new Hono();
app.use('/api/*', cors({ origin: 'http://localhost:5174' }));
app.route('/', importRoutes);
app.route('/', orgRoutes);
app.route('/', analyticsRoutes);

const port = parseInt(process.env.RESEARCH_PORT ?? '3002', 10);
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Research server running on http://localhost:${port}`);
});

export { app };
