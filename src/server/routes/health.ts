import { Hono } from 'hono';
import { db } from '../db/client.js';
import { appConfig } from '../db/schema.js';

const health = new Hono();

health.get('/api/health', (c) => {
  try {
    // Verify DB is accessible by running a simple query
    db.select().from(appConfig).limit(1).get();
    return c.json({
      status: 'ok' as const,
      db: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return c.json({
      status: 'error' as const,
      db: 'disconnected',
      timestamp: new Date().toISOString(),
    }, 500);
  }
});

export default health;
