import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';

// Build a minimal in-memory test database for tests that need the db client
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collection_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      cursor TEXT,
      last_page INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      last_run_at INTEGER,
      error_message TEXT,
      direction TEXT,
      oldest_month_collected TEXT,
      depth_target TEXT
    );
    CREATE UNIQUE INDEX idx_collection_repo_type_unique ON collection_state (repo_id, resource_type);
  `);
  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Mock analytics services so route tests don't need full DB state
vi.mock('../services/analytics-cohorts.js', () => ({
  getCohortCommitMetrics: vi.fn().mockReturnValue([]),
  getCohortPrMetrics: vi.fn().mockReturnValue([]),
}));
vi.mock('../services/analytics-rampup.js', () => ({
  getRampUpCurves: vi.fn().mockReturnValue([]),
}));
vi.mock('../services/analytics-rolling.js', () => ({
  getRollingComparison: vi.fn().mockReturnValue({}),
}));

describe('Health endpoint (INFR-02)', () => {
  it('GET /api/health returns status ok with db connected', async () => {
    const healthModule = await import('../routes/health.js');
    const app = new Hono();
    app.route('/', healthModule.default);

    const res = await app.request('/api/health');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('connected');
    expect(body.timestamp).toBeDefined();
  });
});

describe('Analytics cohort endpoints — date validation (BUG-06)', () => {
  async function getAnalyticsApp() {
    const analyticsModule = await import('../routes/analytics.js');
    const app = new Hono();
    app.route('/', analyticsModule.default);
    return app;
  }

  it('GET /api/analytics/cohorts/commits with invalid startDate returns 400', async () => {
    const app = await getAnalyticsApp();
    const res = await app.request(
      '/api/analytics/cohorts/commits?startDate=garbage&endDate=2024-12-31'
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('GET /api/analytics/cohorts/commits with invalid endDate returns 400', async () => {
    const app = await getAnalyticsApp();
    const res = await app.request(
      '/api/analytics/cohorts/commits?startDate=2024-01-01&endDate=not-a-date'
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('GET /api/analytics/cohorts/commits with valid dates returns 200', async () => {
    const app = await getAnalyticsApp();
    const res = await app.request(
      '/api/analytics/cohorts/commits?startDate=2024-01-01&endDate=2024-12-31'
    );
    expect(res.status).toBe(200);
  });

  it('GET /api/analytics/cohorts/prs with invalid startDate returns 400', async () => {
    const app = await getAnalyticsApp();
    const res = await app.request(
      '/api/analytics/cohorts/prs?startDate=not-a-date&endDate=2024-12-31'
    );
    expect(res.status).toBe(400);
  });

  it('GET /api/analytics/cohorts/prs with valid dates returns 200', async () => {
    const app = await getAnalyticsApp();
    const res = await app.request(
      '/api/analytics/cohorts/prs?startDate=2024-01-01&endDate=2024-12-31'
    );
    expect(res.status).toBe(200);
  });
});
