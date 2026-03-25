import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import 'dotenv/config';
import { runMigrations } from './db/migrate.js';
import { sqlite } from './db/client.js';
import { collectionQueue } from './services/collection-queue.js';
import health from './routes/health.js';
import settings from './routes/settings.js';
import repositories from './routes/repositories.js';
import collection from './routes/collection.js';
import analytics from './routes/analytics.js';

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
app.route('/', collection);
app.route('/', analytics);

const port = parseInt(process.env.PORT ?? '3001', 10);

const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// Graceful shutdown — close server, stop collection, close DB so tsx can restart cleanly
function shutdown() {
  collectionQueue.stopAll();
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
  // Force exit if server.close() hangs (e.g. open SSE connections)
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app };
