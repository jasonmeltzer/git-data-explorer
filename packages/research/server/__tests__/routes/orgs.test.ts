/**
 * Route integration tests for the 4 new research per-org endpoints introduced in Phase 9.4:
 *   GET /api/orgs/:orgId/concentration
 *   GET /api/orgs/:orgId/headcount
 *   GET /api/orgs/:orgId/period-metrics
 *   GET /api/orgs/:orgId/snapshots/:snapshotId/data  (H2 regression: was hardcoded empty arrays)
 *
 * Pattern: vi.mock('../../db/client.js') with in-memory better-sqlite3, dynamic import
 * of route module after mock, Hono app constructed via app.route(), app.request() calls.
 *
 * Tests cover per D-05:
 *   - Happy path: returns mapped rows from latest snapshot
 *   - No snapshot path: returns [] or null when org has no snapshots
 *   - Uses LATEST snapshot when multiple exist
 *   - 400 for invalid orgId
 *   - H2 regression: snapshot reconstruction includes non-empty Phase 9.4 sections
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../db/schema.js';

// ── Full schema SQL (sourced from server/index.ts — single source of truth) ───
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    size_category TEXT,
    import_source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    import_timestamp INTEGER NOT NULL,
    metadata_json TEXT NOT NULL,
    tool_version TEXT,
    start_date TEXT,
    end_date TEXT,
    ai_marker_date TEXT,
    contributor_count INTEGER,
    repo_count INTEGER,
    content_hash TEXT,
    executive_summary_json TEXT,
    before_after_json TEXT
  );
  CREATE TABLE IF NOT EXISTS cohort_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    metric_type TEXT NOT NULL,
    cohort TEXT NOT NULL,
    period TEXT NOT NULL,
    period_month TEXT NOT NULL,
    avg_lines_added REAL NOT NULL DEFAULT 0,
    avg_lines_deleted REAL NOT NULL DEFAULT 0,
    avg_files_changed REAL NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    contributor_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS ramp_up (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    week_index INTEGER NOT NULL,
    join_period TEXT NOT NULL,
    avg_lines_changed REAL NOT NULL DEFAULT 0,
    avg_files_changed REAL NOT NULL DEFAULT 0,
    contribution_count INTEGER NOT NULL DEFAULT 0,
    contributor_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rolling_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    data_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    author_login TEXT NOT NULL,
    cohort TEXT NOT NULL,
    first_commit_at TEXT,
    pre_json TEXT,
    post_json TEXT
  );
  CREATE TABLE IF NOT EXISTS pr_turnaround (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    avg_hours_to_merge REAL NOT NULL DEFAULT 0,
    median_hours_to_merge REAL NOT NULL DEFAULT 0,
    pr_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bot_ratio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    bot_commits INTEGER NOT NULL DEFAULT 0,
    human_commits INTEGER NOT NULL DEFAULT 0,
    total_commits INTEGER NOT NULL DEFAULT 0,
    bot_percentage REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS concentration_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    basis TEXT NOT NULL,
    period_month TEXT NOT NULL,
    top1_share REAL,
    top3_share REAL,
    top5_share REAL,
    hhi REAL,
    gini REAL,
    bus_factor INTEGER,
    active_devs INTEGER NOT NULL,
    top_contributor TEXT
  );
  CREATE TABLE IF NOT EXISTS headcount_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    active_devs INTEGER NOT NULL,
    total_prs INTEGER NOT NULL,
    total_commits INTEGER NOT NULL,
    prs_per_dev REAL,
    commits_per_dev REAL
  );
  CREATE TABLE IF NOT EXISTS period_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    data_json TEXT NOT NULL
  );
`;

// ── In-memory test DB ─────────────────────────────────────────────────────────
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(CREATE_TABLES_SQL);
  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

// ── Module mocks (must be declared before dynamic imports) ────────────────────
vi.mock('../../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// org-service uses db from '../../db/client.js' — same mock path covers it
vi.mock('../../services/org-service.js', async (importOriginal) => {
  // Re-export the real implementations — they will use the mocked db
  return importOriginal();
});

// ── Minimal metadata JSON for snapshots ──────────────────────────────────────
const MINIMAL_METADATA = JSON.stringify({
  exportTimestamp: '2025-04-01T00:00:00Z',
  startDate: '2025-01-01',
  endDate: '2025-04-01',
  aiMarkerDate: '2025-02-15',
  tenureMode: 'global',
  repoIds: [1],
  repoNames: ['org/repo'],
  cohortConfig: {
    thresholds: [
      { maxMonths: 3, key: 'new', label: '0-3mo', color: '#4a90d9' },
      { maxMonths: 12, key: 'mid', label: '3-12mo', color: '#82b366' },
      { maxMonths: null, key: 'senior', label: '1yr+', color: '#d9a441' },
    ],
  },
  toolVersion: '1.0.0',
  rollingGranularity: 'month',
  orgName: 'TestOrg',
});

const PERIOD_METRICS_DATA = JSON.stringify([
  {
    period: { startDate: '2025-01-01', endDate: '2025-02-15', label: 'Before AI' },
    metrics: { avgCommitSize: 55.2, prFrequency: 3.1, rampUpSpeed: 4.5, activeContributors: 8 },
  },
  {
    period: { startDate: '2025-02-15', endDate: '2025-04-01', label: 'After AI', markerDate: '2025-02-15' },
    metrics: { avgCommitSize: 72.8, prFrequency: 4.8, rampUpSpeed: 2.8, activeContributors: 12 },
  },
]);

// ── Seed helpers ──────────────────────────────────────────────────────────────

/**
 * Seeds the canonical test scenario:
 *   - Org 1 (TestOrg) with 2 snapshots (newer id=2, older id=1)
 *   - Snapshot 1 (older): no Phase 9.4 data
 *   - Snapshot 2 (newer): 6 concentration rows (3 bases × 2 months),
 *     2 headcount rows, 1 period_metrics blob
 *
 * Org 2 exists but has no snapshots (for empty-org tests).
 * Org 3 has snapshot 3 (for the org-mismatch 404 test).
 */
function seedAll() {
  const raw = testDb.$client;

  // Clear in reverse FK order
  raw.exec(`DELETE FROM period_metrics`);
  raw.exec(`DELETE FROM headcount_monthly`);
  raw.exec(`DELETE FROM concentration_monthly`);
  raw.exec(`DELETE FROM bot_ratio`);
  raw.exec(`DELETE FROM pr_turnaround`);
  raw.exec(`DELETE FROM contributors`);
  raw.exec(`DELETE FROM rolling_comparisons`);
  raw.exec(`DELETE FROM ramp_up`);
  raw.exec(`DELETE FROM cohort_metrics`);
  raw.exec(`DELETE FROM snapshots`);
  raw.exec(`DELETE FROM orgs`);

  // Orgs
  raw.prepare(`INSERT INTO orgs (id, label, import_source, created_at) VALUES (1, 'TestOrg', 'file', ${Date.now()})`).run();
  raw.prepare(`INSERT INTO orgs (id, label, import_source, created_at) VALUES (2, 'EmptyOrg', 'file', ${Date.now()})`).run();
  raw.prepare(`INSERT INTO orgs (id, label, import_source, created_at) VALUES (3, 'OtherOrg', 'file', ${Date.now()})`).run();

  // Snapshot 1 (older — import_timestamp smaller)
  raw.prepare(`
    INSERT INTO snapshots (id, org_id, import_timestamp, metadata_json, content_hash)
    VALUES (1, 1, 1000, '${MINIMAL_METADATA}', 'hash-older')
  `).run();

  // Snapshot 2 (newer — import_timestamp larger; should be used by getLatestSnapshotId)
  raw.prepare(`
    INSERT INTO snapshots (id, org_id, import_timestamp, metadata_json, content_hash)
    VALUES (2, 1, 2000, '${MINIMAL_METADATA}', 'hash-newer')
  `).run();

  // Snapshot 3 (belongs to org 3 — for org-mismatch 404 test)
  raw.prepare(`
    INSERT INTO snapshots (id, org_id, import_timestamp, metadata_json, content_hash)
    VALUES (3, 3, 3000, '${MINIMAL_METADATA}', 'hash-org3')
  `).run();

  // concentration_monthly rows for snapshot 2 (newest): 3 bases × 2 months
  const concentrationRows = [
    { basis: 'commits', period_month: '2025-01', top1_share: 60.0, top3_share: 100.0, top5_share: 100.0, hhi: 0.42, gini: 0.25, bus_factor: 1, active_devs: 3, top_contributor: 'alice' },
    { basis: 'commits', period_month: '2025-02', top1_share: 50.0, top3_share: 100.0, top5_share: 100.0, hhi: 0.38, gini: 0.20, bus_factor: 1, active_devs: 4, top_contributor: 'bob' },
    { basis: 'prs', period_month: '2025-01', top1_share: 67.0, top3_share: 100.0, top5_share: 100.0, hhi: 0.55, gini: 0.30, bus_factor: 1, active_devs: 3, top_contributor: 'alice' },
    { basis: 'prs', period_month: '2025-02', top1_share: 100.0, top3_share: 100.0, top5_share: 100.0, hhi: 1.0, gini: 0.0, bus_factor: 1, active_devs: 1, top_contributor: 'carol' },
    { basis: 'lines', period_month: '2025-01', top1_share: 70.0, top3_share: 100.0, top5_share: 100.0, hhi: 0.52, gini: 0.28, bus_factor: 1, active_devs: 3, top_contributor: 'alice' },
    { basis: 'lines', period_month: '2025-02', top1_share: 55.0, top3_share: 100.0, top5_share: 100.0, hhi: 0.40, gini: 0.22, bus_factor: 2, active_devs: 3, top_contributor: 'alice' },
  ];
  for (const r of concentrationRows) {
    raw.prepare(`
      INSERT INTO concentration_monthly
        (snapshot_id, org_id, basis, period_month, top1_share, top3_share, top5_share, hhi, gini, bus_factor, active_devs, top_contributor)
      VALUES (2, 1, '${r.basis}', '${r.period_month}', ${r.top1_share}, ${r.top3_share}, ${r.top5_share}, ${r.hhi}, ${r.gini}, ${r.bus_factor}, ${r.active_devs}, '${r.top_contributor}')
    `).run();
  }

  // headcount_monthly rows for snapshot 2
  raw.prepare(`
    INSERT INTO headcount_monthly
      (snapshot_id, org_id, period_month, active_devs, total_prs, total_commits, prs_per_dev, commits_per_dev)
    VALUES (2, 1, '2025-01', 3, 4, 9, 1.33, 3.0)
  `).run();
  raw.prepare(`
    INSERT INTO headcount_monthly
      (snapshot_id, org_id, period_month, active_devs, total_prs, total_commits, prs_per_dev, commits_per_dev)
    VALUES (2, 1, '2025-02', 4, 2, 8, 0.5, 2.0)
  `).run();

  // period_metrics for snapshot 2
  raw.prepare(`
    INSERT INTO period_metrics (snapshot_id, org_id, data_json)
    VALUES (2, 1, '${PERIOD_METRICS_DATA}')
  `).run();
}

// ── App factory ───────────────────────────────────────────────────────────────
async function getOrgsApp() {
  const routeModule = await import('../../routes/orgs.js');
  const app = new Hono();
  app.route('/', routeModule.default);
  return app;
}

// ── Tests: GET /api/orgs/:orgId/concentration ─────────────────────────────────

describe('GET /api/orgs/:orgId/concentration', () => {
  beforeAll(() => { seedAll(); });

  it('returns mapped rows from latest snapshot (DB names → API field names)', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/concentration');
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    // Verify field name mapping: DB has period_month → API should expose as 'month'
    expect(row).toHaveProperty('month');       // NOT periodMonth
    expect(row).toHaveProperty('basis');
    expect(row).toHaveProperty('top1Share');   // NOT top1_share
    expect(row).toHaveProperty('hhi');
    expect(row).toHaveProperty('gini');
    expect(row).toHaveProperty('busFactor');   // NOT bus_factor
    expect(row).toHaveProperty('activeDevs');  // NOT active_devs
    expect(row).toHaveProperty('topContributor');
  });

  it('returns [] when org has no snapshots (getLatestSnapshotId returns null)', async () => {
    const app = await getOrgsApp();
    // Org 2 was seeded with no snapshots
    const res = await app.request('/api/orgs/2/concentration');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('uses LATEST snapshot when multiple exist', async () => {
    const app = await getOrgsApp();
    // Org 1 has snapshots 1 (older, no data) and 2 (newer, 6 rows)
    const res = await app.request('/api/orgs/1/concentration');
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<Record<string, unknown>>;
    // Should return rows from snapshot 2 (newest)
    expect(rows.length).toBe(6);
  });

  it('returns 400 for invalid (non-numeric) orgId', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/abc/concentration');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ── Tests: GET /api/orgs/:orgId/headcount ────────────────────────────────────

describe('GET /api/orgs/:orgId/headcount', () => {
  beforeAll(() => { seedAll(); });

  it('returns mapped rows from latest snapshot', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/headcount');
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row).toHaveProperty('month');         // NOT periodMonth
    expect(row).toHaveProperty('activeDevs');    // NOT active_devs
    expect(row).toHaveProperty('totalPrs');      // NOT total_prs
    expect(row).toHaveProperty('totalCommits');  // NOT total_commits
    expect(row).toHaveProperty('prsPerDev');
    expect(row).toHaveProperty('commitsPerDev');
  });

  it('returns [] when org has no snapshots', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/2/headcount');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('uses LATEST snapshot when multiple exist', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/headcount');
    expect(res.status).toBe(200);
    const rows = await res.json() as Array<Record<string, unknown>>;
    // Snapshot 2 has 2 headcount rows; snapshot 1 has none
    expect(rows.length).toBe(2);
  });

  it('returns 400 for invalid (non-numeric) orgId', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/abc/headcount');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ── Tests: GET /api/orgs/:orgId/period-metrics ────────────────────────────────

describe('GET /api/orgs/:orgId/period-metrics', () => {
  beforeAll(() => { seedAll(); });

  it('returns parsed PeriodMetric[] array from latest snapshot', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/period-metrics');
    expect(res.status).toBe(200);
    const body = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0]).toHaveProperty('period');
    expect(body[0]).toHaveProperty('metrics');
  });

  it('returns null when org has no snapshots', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/2/period-metrics');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it('returns null when latest snapshot has no period_metrics row', async () => {
    const raw = testDb.$client;
    // Temporarily remove period_metrics for snapshot 2
    raw.exec(`DELETE FROM period_metrics WHERE snapshot_id = 2`);
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/period-metrics');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
    // Restore
    raw.prepare(`INSERT INTO period_metrics (snapshot_id, org_id, data_json) VALUES (2, 1, '${PERIOD_METRICS_DATA}')`).run();
  });

  it('returns 400 for invalid (non-numeric) orgId', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/abc/period-metrics');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});

// ── Tests: GET /api/orgs/:orgId/snapshots/:snapshotId/data (H2 regression) ───

describe('GET /api/orgs/:orgId/snapshots/:snapshotId/data', () => {
  beforeAll(() => { seedAll(); });

  it('includes non-empty Phase 9.4 sections when data exists (H2 regression test)', async () => {
    // This test would fail if the route regressed to hardcoded empty arrays
    // (the bug that was fixed in the H2 audit finding)
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/snapshots/2/data');
    expect(res.status).toBe(200);
    const bundle = await res.json() as Record<string, unknown>;

    // H2: concentrationMonthly MUST NOT be empty when rows exist
    expect(bundle.concentrationMonthly).toBeDefined();
    expect(Array.isArray(bundle.concentrationMonthly)).toBe(true);
    expect((bundle.concentrationMonthly as unknown[]).length).toBeGreaterThan(0);

    // H2: headcountMonthly MUST NOT be empty when rows exist
    expect(bundle.headcountMonthly).toBeDefined();
    expect(Array.isArray(bundle.headcountMonthly)).toBe(true);
    expect((bundle.headcountMonthly as unknown[]).length).toBeGreaterThan(0);

    // H2: periodMetrics MUST NOT be null when a row exists
    expect(bundle.periodMetrics).not.toBeNull();
    expect(Array.isArray(bundle.periodMetrics)).toBe(true);
    expect((bundle.periodMetrics as unknown[]).length).toBe(2);
  });

  it('concentration rows are correctly mapped (DB columns → API field names)', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/snapshots/2/data');
    expect(res.status).toBe(200);
    const bundle = await res.json() as Record<string, unknown>;
    const rows = bundle.concentrationMonthly as Array<Record<string, unknown>>;
    const row = rows[0];
    expect(row).toHaveProperty('month');         // not periodMonth
    expect(row).toHaveProperty('basis');
    expect(row).toHaveProperty('top1Share');     // not top1_share
    expect(row).toHaveProperty('busFactor');     // not bus_factor
    expect(row).toHaveProperty('activeDevs');    // not active_devs
  });

  it('returns empty arrays for Phase 9.4 sections when snapshot has no data', async () => {
    // Snapshot 1 (older) has no Phase 9.4 rows
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/snapshots/1/data');
    expect(res.status).toBe(200);
    const bundle = await res.json() as Record<string, unknown>;
    expect(bundle.concentrationMonthly).toEqual([]);
    expect(bundle.headcountMonthly).toEqual([]);
    expect(bundle.periodMetrics).toBeNull();
  });

  it('returns 404 when snapshot belongs to different org (orgId mismatch)', async () => {
    // Snapshot 3 belongs to org 3, not org 1
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/snapshots/3/data');
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns 404 when snapshot does not exist at all', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/snapshots/999/data');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid (non-numeric) orgId', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/abc/snapshots/1/data');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });

  it('returns 400 for invalid (non-numeric) snapshotId', async () => {
    const app = await getOrgsApp();
    const res = await app.request('/api/orgs/1/snapshots/abc/data');
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('error');
  });
});
