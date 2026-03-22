import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import 'dotenv/config';
import { runMigrations } from './db/migrate.js';
import health from './routes/health.js';
import settings from './routes/settings.js';
import repositories from './routes/repositories.js';

// Run migrations synchronously before accepting requests
runMigrations();
console.log('Database migrations applied');

const app = new Hono();

// CORS for development (Vite proxy handles this, but belt-and-suspenders)
app.use('/api/*', cors({ origin: 'http://localhost:5173' }));

// Mount routes
app.route('/', health);
app.route('/', settings);
app.route('/', repositories);

const port = parseInt(process.env.PORT ?? '3001', 10);

serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export { app };
