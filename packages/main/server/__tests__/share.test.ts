/**
 * Tests for share routes (POST /api/share/gist, GET /api/share/reachability, POST /api/share/http)
 * and export route (POST /api/export) and sharing consent settings endpoints.
 *
 * Uses vi.mock for external dependencies (export-service, token, @octokit/rest).
 * Uses in-memory SQLite for settings/sharing consent state tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { DEFAULT_COHORT_CONFIG } from '@shared/cohort-config.js';

// ─── In-memory test DB ────────────────────────────────────────────────────────

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
  `);
  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// ─── Mock export-service ──────────────────────────────────────────────────────

const stubBundle = {
  metadata: {
    exportTimestamp: '2024-01-01T00:00:00.000Z',
    startDate: '2024-01-01',
    endDate: '2024-12-31',
    aiMarkerDate: null,
    tenureMode: 'global' as const,
    repoIds: [],
    repoNames: [],
    cohortConfig: DEFAULT_COHORT_CONFIG,
    toolVersion: '1.0.0',
    rollingGranularity: 'month' as const,
    orgName: null,
  },
  cohortCommits: [],
  cohortPrs: [],
  rampUp: [],
  rolling: null,
  contributors: [],
  prTurnaround: [],
  botRatio: [],
  executiveSummary: null,
  periodMetrics: null,
  concentrationMonthly: [],
  headcountMonthly: [],
  developerMonthly: [],   // Phase 9.5-01 — type-skeleton stub
};

vi.mock('../services/export-service.js', () => ({
  buildExportBundle: vi.fn().mockReturnValue(stubBundle),
}));

// ─── Mock token service ───────────────────────────────────────────────────────

const mockReadToken = vi.fn<() => string | null>().mockReturnValue(null);

vi.mock('../services/token.js', () => ({
  readToken: () => mockReadToken(),
  getTokenStatus: vi.fn().mockReturnValue({ configured: false, maskedToken: null }),
  validateAndSaveToken: vi.fn(),
}));

// ─── Mock @octokit/rest ───────────────────────────────────────────────────────

const mockGistsCreate = vi.fn();

vi.mock('@octokit/rest', () => {
  // Must be a class (constructor) for `new Octokit(...)` to work
  class MockOctokit {
    rest = { gists: { create: mockGistsCreate } };
    constructor(_options?: unknown) {}
  }
  return { Octokit: MockOctokit };
});

// ─── Helper: build app with specific routes ───────────────────────────────────

async function getExportApp() {
  const exportModule = await import('../routes/export.js');
  const app = new Hono();
  app.route('/', exportModule.default);
  return app;
}

async function getShareApp() {
  const shareModule = await import('../routes/share.js');
  const app = new Hono();
  app.route('/', shareModule.default);
  return app;
}

async function getSettingsApp() {
  const settingsModule = await import('../routes/settings.js');
  const app = new Hono();
  app.route('/', settingsModule.default);
  return app;
}

// ─── Export route tests ───────────────────────────────────────────────────────

describe('POST /api/export', () => {
  it('returns 200 with ExportBundle JSON for valid body', async () => {
    const { buildExportBundle } = await import('../services/export-service.js');
    vi.mocked(buildExportBundle).mockReturnValue(stubBundle);

    const app = await getExportApp();
    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
        repoIds: [],
        tenureMode: 'global',
        rollingGranularity: 'month',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('metadata');
  });

  it('returns 400 for empty/invalid body', async () => {
    const app = await getExportApp();
    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    // Empty object missing required string fields → 400
    expect(res.status).toBe(400);
  });
});

// ─── Share reachability tests ─────────────────────────────────────────────────

describe('GET /api/share/reachability', () => {
  beforeEach(() => {
    delete process.env.SHARING_ENDPOINT_URL;
  });

  it('returns { reachable: false } when SHARING_ENDPOINT_URL is not set', async () => {
    const app = await getShareApp();
    const res = await app.request('/api/share/reachability');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ reachable: false });
  });
});

// ─── Share gist tests ─────────────────────────────────────────────────────────

describe('POST /api/share/gist', () => {
  beforeEach(() => {
    mockGistsCreate.mockReset();
    mockReadToken.mockReturnValue(null);
  });

  it('returns 401 when no token is configured', async () => {
    mockReadToken.mockReturnValue(null);

    const app = await getShareApp();
    const res = await app.request('/api/share/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'summary', data: stubBundle }),
    });

    expect(res.status).toBe(401);
  });

  it('returns gistUrl on successful Gist creation', async () => {
    mockReadToken.mockReturnValue('ghp_faketoken12345');
    mockGistsCreate.mockResolvedValue({
      data: { html_url: 'https://gist.github.com/user/abc123' },
    });

    const app = await getShareApp();
    const res = await app.request('/api/share/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'summary', data: stubBundle }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('gistUrl');
    expect(body.gistUrl).toBe('https://gist.github.com/user/abc123');
  });

  it('returns 403 with scope error message when Gist creation returns 403', async () => {
    mockReadToken.mockReturnValue('ghp_noscope12345');
    const scopeError = new Error('Resource not accessible by personal access token');
    (scopeError as Error & { status?: number }).status = 403;
    mockGistsCreate.mockRejectedValue(scopeError);

    const app = await getShareApp();
    const res = await app.request('/api/share/gist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'summary', data: stubBundle }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('gist');
  });
});

// ─── Sharing consent settings tests ──────────────────────────────────────────

describe('GET /api/settings/sharing', () => {
  it('returns default state when no keys are set', async () => {
    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      promptShown: false,
      declined: false,
      enabled: false,
      exportCount: 0,
    });
  });
});

describe('PUT /api/settings/sharing/decline', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
  });

  it('sets sharing_declined and sharing_prompt_shown to true', async () => {
    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/decline', {
      method: 'PUT',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Verify state persisted
    const stateRes = await app.request('/api/settings/sharing');
    const state = await stateRes.json();
    expect(state.declined).toBe(true);
    expect(state.promptShown).toBe(true);
  });
});

describe('POST /api/settings/sharing/increment-export', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
  });

  it('increments export_count by 1 each call', async () => {
    const app = await getSettingsApp();

    // First increment
    const res1 = await app.request('/api/settings/sharing/increment-export', {
      method: 'POST',
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.exportCount).toBeGreaterThan(0);

    // Second increment
    const res2 = await app.request('/api/settings/sharing/increment-export', {
      method: 'POST',
    });
    const body2 = await res2.json();
    expect(body2.exportCount).toBe(body1.exportCount + 1);
  });
});

// ─── Eligibility endpoint tests ───────────────────────────────────────────────

describe('GET /api/settings/sharing/eligible', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
    testDb.delete(schema.collectionState).run();
  });

  it('returns { eligible: false } when export_count is 0', async () => {
    // No keys set — export_count defaults to 0
    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(false);
  });

  it('returns { eligible: false } when sharing_declined is true', async () => {
    // Set export_count >= 1 and add qualifying repos, but declined
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    testDb.insert(schema.appConfig).values([
      { key: 'export_count', value: '2', updatedAt: new Date() },
      { key: 'sharing_declined', value: 'true', updatedAt: new Date() },
    ]).run();
    testDb.insert(schema.collectionState).values([
      { repoId: 1, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
      { repoId: 2, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(false);
  });

  it('returns { eligible: false } when fewer than 2 repos have 3+ months of history', async () => {
    // Only 1 qualifying repo
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    testDb.insert(schema.appConfig).values([
      { key: 'export_count', value: '1', updatedAt: new Date() },
    ]).run();
    testDb.insert(schema.collectionState).values([
      { repoId: 1, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(false);
  });

  it('returns { eligible: true } when all gates pass', async () => {
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    testDb.insert(schema.appConfig).values([
      { key: 'export_count', value: '1', updatedAt: new Date() },
    ]).run();
    testDb.insert(schema.collectionState).values([
      { repoId: 1, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
      { repoId: 2, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(true);
  });

  it('returns { eligible: false } when sharing_dismiss_count >= 3 (D-07 soft decline)', async () => {
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    testDb.insert(schema.appConfig).values([
      { key: 'export_count', value: '1', updatedAt: new Date() },
      { key: 'sharing_dismiss_count', value: '3', updatedAt: new Date() },
    ]).run();
    testDb.insert(schema.collectionState).values([
      { repoId: 1, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
      { repoId: 2, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(false);
  });

  it('returns { eligible: false } when sharing_prompt_dismissed_at is within 24 hours (D-06 cooldown)', async () => {
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    testDb.insert(schema.appConfig).values([
      { key: 'export_count', value: '1', updatedAt: new Date() },
      { key: 'sharing_prompt_dismissed_at', value: oneHourAgo, updatedAt: new Date() },
    ]).run();
    testDb.insert(schema.collectionState).values([
      { repoId: 1, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
      { repoId: 2, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(false);
  });

  it('returns { eligible: true } when sharing_prompt_dismissed_at is older than 24 hours', async () => {
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    testDb.insert(schema.appConfig).values([
      { key: 'export_count', value: '1', updatedAt: new Date() },
      { key: 'sharing_prompt_dismissed_at', value: twoDaysAgo, updatedAt: new Date() },
    ]).run();
    testDb.insert(schema.collectionState).values([
      { repoId: 1, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
      { repoId: 2, resourceType: 'commits', status: 'complete', oldestMonthCollected: fourMonthsAgo },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/eligible');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(true);
  });
});

// ─── Dismiss endpoint tests ───────────────────────────────────────────────────

describe('PUT /api/settings/sharing/dismiss', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
    testDb.delete(schema.collectionState).run();
  });

  it('increments sharing_dismiss_count and sets sharing_prompt_dismissed_at', async () => {
    const app = await getSettingsApp();
    const before = Date.now();

    const res = await app.request('/api/settings/sharing/dismiss', { method: 'PUT' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    // Verify dismiss_count incremented from 0 to 1
    const countRow = testDb.select().from(schema.appConfig)
      .all()
      .find(r => r.key === 'sharing_dismiss_count');
    expect(countRow?.value).toBe('1');

    // Verify dismissed_at is set to a recent timestamp
    const tsRow = testDb.select().from(schema.appConfig)
      .all()
      .find(r => r.key === 'sharing_prompt_dismissed_at');
    expect(tsRow).toBeDefined();
    const ts = new Date(tsRow!.value).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
  });

  it('increments dismiss_count from an existing value', async () => {
    testDb.insert(schema.appConfig).values([
      { key: 'sharing_dismiss_count', value: '2', updatedAt: new Date() },
    ]).run();

    const app = await getSettingsApp();
    await app.request('/api/settings/sharing/dismiss', { method: 'PUT' });

    const countRow = testDb.select().from(schema.appConfig)
      .all()
      .find(r => r.key === 'sharing_dismiss_count');
    expect(countRow?.value).toBe('3');
  });
});

// ─── Enable endpoint full reset tests ────────────────────────────────────────

describe('PUT /api/settings/sharing/enable — full D-08 reset', () => {
  beforeEach(() => {
    testDb.delete(schema.appConfig).run();
    testDb.delete(schema.collectionState).run();
  });

  it('clears sharing_declined, resets sharing_dismiss_count to 0, and deletes sharing_prompt_dismissed_at', async () => {
    // Seed existing dismiss state
    testDb.insert(schema.appConfig).values([
      { key: 'sharing_declined', value: 'true', updatedAt: new Date() },
      { key: 'sharing_dismiss_count', value: '2', updatedAt: new Date() },
      { key: 'sharing_prompt_dismissed_at', value: new Date(Date.now() - 3600000).toISOString(), updatedAt: new Date() },
    ]).run();

    const app = await getSettingsApp();
    const res = await app.request('/api/settings/sharing/enable', { method: 'PUT' });
    expect(res.status).toBe(200);

    const allKeys = testDb.select().from(schema.appConfig).all();

    const declined = allKeys.find(r => r.key === 'sharing_declined');
    expect(declined?.value).toBe('false');

    const dismissCount = allKeys.find(r => r.key === 'sharing_dismiss_count');
    expect(dismissCount?.value).toBe('0');

    const dismissedAt = allKeys.find(r => r.key === 'sharing_prompt_dismissed_at');
    expect(dismissedAt).toBeUndefined();
  });
});
