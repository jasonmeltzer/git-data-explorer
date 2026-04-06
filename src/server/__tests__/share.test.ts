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

// ─── In-memory test DB ────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
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
    tenureMode: 'global',
    repoIds: [],
    repoNames: [],
    cohortConfig: { thresholds: [] },
    toolVersion: '1.0.0',
    rollingGranularity: 'month',
  },
  cohortCommits: [],
  cohortPrs: [],
  rampUp: [],
  rolling: null,
  contributors: [],
  prTurnaround: [],
  botRatio: [],
  executiveSummary: null,
  beforeAfter: null,
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
const MockOctokit = vi.fn().mockImplementation(() => ({
  rest: {
    gists: {
      create: mockGistsCreate,
    },
  },
}));

vi.mock('@octokit/rest', () => ({
  Octokit: MockOctokit,
}));

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
    vi.clearAllMocks();
    mockReadToken.mockReturnValue(null);
    MockOctokit.mockImplementation(() => ({
      rest: { gists: { create: mockGistsCreate } },
    }));
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
