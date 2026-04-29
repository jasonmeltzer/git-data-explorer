/**
 * Phase 9.4 End-to-End Round-Trip Test
 *
 * Scope: Tests the FULL Phase 9.4 data pipeline:
 *   ExportBundle (synthetic) → bundleToZip (fflate zipSync) → parseZipBundle
 *   → importBundle (real import-service, mocked DB) → GET /api/orgs/:orgId/snapshots/:snapshotId/data
 *   → assert every concentrationMonthly / headcountMonthly / periodMetrics field equals original
 *
 * See round-trip.test.ts for the pre-9.4 pipeline contract (cohort metrics,
 * ramp-up, rolling, contributors, pr-turnaround, bot-ratio).
 *
 * NOTE: The existing round-trip.test.ts CREATE_TABLES_SQL block does NOT include
 * the Phase 9.4 tables (concentration_monthly, headcount_monthly, period_metrics).
 * This is a pre-existing gap documented here. This test file maintains its own
 * CREATE_TABLES_SQL that includes all 11 tables (8 original + 3 Phase 9.4).
 * Tracked in SUMMARY: the legacy round-trip.test.ts CREATE_TABLES_SQL and the
 * readBackBundle helper return empty arrays / null for Phase 9.4 sections.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { zipSync, strToU8 } from 'fflate';
import * as schema from '../db/schema.js';
import type { ExportBundle, ConcentrationMonthlyRow, HeadcountMonthlyRow, PeriodMetric, DeveloperMonthlyRow } from '@shared/export-types.js';

// ── Full schema SQL (includes Phase 9.4 tables) ───────────────────────────────
// Sourced from packages/research/server/index.ts (the single source of truth for
// the research DB). The Phase 9.4 tables (concentration_monthly, headcount_monthly,
// period_metrics) were added in Plan 09.4-08. The legacy round-trip.test.ts
// CREATE_TABLES_SQL predates 9.4 and is missing these tables.
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
  CREATE TABLE IF NOT EXISTS developer_monthly (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    author_login TEXT NOT NULL,
    period_month TEXT NOT NULL,
    pr_count INTEGER NOT NULL,
    commit_count INTEGER NOT NULL,
    mean_lines_per_commit REAL,
    median_lines_per_commit REAL,
    mean_files_per_commit REAL,
    median_files_per_commit REAL
  );
`;

// ── In-memory research DB ─────────────────────────────────────────────────────
const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(CREATE_TABLES_SQL);
const testDb = drizzle(sqlite, { schema });

// ── Module mocks (hoisted before any import that uses the DB) ─────────────────
vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

vi.mock('../services/org-service.js', async (importOriginal) => {
  return importOriginal();
});

// ── Dynamic imports (after mocks are hoisted) ─────────────────────────────────
const { parseZipBundle, importBundle } = await import('../services/import-service.js');
const orgsRouteModule = await import('../routes/orgs.js');

// ── Hono app factory ──────────────────────────────────────────────────────────
function getApp() {
  const app = new Hono();
  app.route('/', orgsRouteModule.default);
  return app;
}

// ── Fixture bundles ───────────────────────────────────────────────────────────

/** Minimal valid ExportBundle with all Phase 9.4 sections populated with known values */
function makePhase94Bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    metadata: {
      exportTimestamp: '2026-04-01T12:00:00Z',
      startDate: '2025-01-01',
      endDate: '2025-04-30',
      aiMarkerDate: '2025-02-15',
      tenureMode: 'global',
      repoIds: [1],
      repoNames: ['acme/api'],
      cohortConfig: {
        thresholds: [
          { maxMonths: 3,    key: 'new',    label: '0–3 mo',  color: '#4a90d9' },
          { maxMonths: 12,   key: 'mid',    label: '3–12 mo', color: '#82b366' },
          { maxMonths: null, key: 'senior', label: '1 yr+',   color: '#d9a441' },
        ],
      },
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: 'acme',
    },
    // Pre-9.4 sections present but minimal (import-service validates them)
    cohortCommits: [],
    cohortPrs: [],
    rampUp: [],
    rolling: null,
    contributors: [],
    prTurnaround: [],
    botRatio: [],
    executiveSummary: null,

    // ── Phase 9.4 sections ────────────────────────────────────────────────────
    // Two bases × 3 months = 6 concentration rows.
    // Using specific float values to verify REAL column round-trip fidelity.
    concentrationMonthly: [
      {
        month: '2025-01', basis: 'commits',
        top1Share: 66.67, top3Share: 100.0, top5Share: 100.0,
        hhi: 0.481481, gini: 0.222222, busFactor: 1, activeDevs: 3, topContributor: 'alice',
      },
      {
        month: '2025-02', basis: 'commits',
        top1Share: 50.0,  top3Share: 91.67, top5Share: 100.0,
        hhi: 0.298611, gini: 0.187500, busFactor: 2, activeDevs: 4, topContributor: 'bob',
      },
      {
        month: '2025-03', basis: 'commits',
        top1Share: 40.0,  top3Share: 80.0,  top5Share: 100.0,
        hhi: 0.204000, gini: 0.160000, busFactor: 3, activeDevs: 5, topContributor: 'carol',
      },
      {
        month: '2025-01', basis: 'prs',
        top1Share: 75.0,  top3Share: 100.0, top5Share: 100.0,
        hhi: 0.593750, gini: 0.250000, busFactor: 1, activeDevs: 2, topContributor: 'alice',
      },
      {
        month: '2025-02', basis: 'prs',
        top1Share: 50.0,  top3Share: 100.0, top5Share: 100.0,
        hhi: 0.375000, gini: 0.250000, busFactor: 2, activeDevs: 2, topContributor: 'bob',
      },
      {
        month: '2025-03', basis: 'prs',
        top1Share: 33.33, top3Share: 100.0, top5Share: 100.0,
        hhi: 0.333333, gini: 0.222222, busFactor: 3, activeDevs: 3, topContributor: 'alice',
      },
    ],
    headcountMonthly: [
      { month: '2025-01', activeDevs: 3,  totalPrs: 4,  totalCommits: 15, prsPerDev: 1.333333, commitsPerDev: 5.0 },
      { month: '2025-02', activeDevs: 4,  totalPrs: 8,  totalCommits: 24, prsPerDev: 2.0,      commitsPerDev: 6.0 },
      { month: '2025-03', activeDevs: 5,  totalPrs: 12, totalCommits: 35, prsPerDev: 2.4,      commitsPerDev: 7.0 },
    ],
    periodMetrics: [
      {
        period: { startDate: '2025-01-01', endDate: '2025-02-15', label: 'Before AI' },
        metrics: { avgCommitSize: 55.2, prFrequency: 3.1, rampUpSpeed: 4.5, activeContributors: 8 },
      },
      {
        period: { startDate: '2025-02-15', endDate: '2025-04-30', label: 'After AI', markerDate: '2025-02-15' },
        metrics: { avgCommitSize: 72.8, prFrequency: 4.8, rampUpSpeed: 2.8, activeContributors: 12 },
      },
    ],
    // Phase 9.5: 3 developers × 1-2 months = 4 total rows
    developerMonthly: [
      { authorLogin: 'amber-bear', month: '2025-01', prCount: 5,  commitCount: 12, meanLinesPerCommit: 80.5,  medianLinesPerCommit: 75.0,  meanFilesPerCommit: 2.4, medianFilesPerCommit: 2 },
      { authorLogin: 'amber-bear', month: '2025-02', prCount: 8,  commitCount: 18, meanLinesPerCommit: 65.25, medianLinesPerCommit: 60.0,  meanFilesPerCommit: 1.8, medianFilesPerCommit: 2 },
      { authorLogin: 'azure-fox',  month: '2025-01', prCount: 3,  commitCount: 7,  meanLinesPerCommit: 120.0, medianLinesPerCommit: 110.0, meanFilesPerCommit: 3.5, medianFilesPerCommit: 3 },
      { authorLogin: 'crystal-owl', month: '2025-03', prCount: 2, commitCount: 4,  meanLinesPerCommit: null,  medianLinesPerCommit: null,  meanFilesPerCommit: null, medianFilesPerCommit: null },
    ],
    ...overrides,
  };
}

/** Serialize an ExportBundle to a ZIP buffer (same format as ExportModal) */
function bundleToZip(bundle: ExportBundle): Buffer {
  const json = (data: unknown) => strToU8(JSON.stringify(data, null, 2));
  const files: Record<string, Uint8Array> = {
    'metadata.json': json(bundle.metadata),
    'cohort-commits.json': json(bundle.cohortCommits),
    'cohort-prs.json': json(bundle.cohortPrs),
    'ramp-up.json': json(bundle.rampUp),
    'contributors.json': json(bundle.contributors),
    'pr-turnaround.json': json(bundle.prTurnaround),
    'bot-ratio.json': json(bundle.botRatio),
  };
  if (bundle.rolling)          files['rolling-comparison.json']  = json(bundle.rolling);
  if (bundle.executiveSummary) files['executive-summary.json']   = json(bundle.executiveSummary);
  if (bundle.periodMetrics)    files['period-metrics.json']      = json(bundle.periodMetrics);
  if (bundle.concentrationMonthly.length > 0) files['concentration-monthly.json'] = json(bundle.concentrationMonthly);
  if (bundle.headcountMonthly.length  > 0) files['headcount-monthly.json']    = json(bundle.headcountMonthly);
  if (bundle.developerMonthly.length   > 0) files['developer-monthly.json']    = json(bundle.developerMonthly);
  return Buffer.from(zipSync(files));
}

// ── Run the full pipeline once for the "populated" scenario ───────────────────
let bundle: ExportBundle;
let orgId: number;
let snapshotId: number;
let reconstructed: ExportBundle;

beforeAll(async () => {
  // Clear DB between test file runs (in case of test-order coupling)
  sqlite.exec(`DELETE FROM developer_monthly`);
  sqlite.exec(`DELETE FROM period_metrics`);
  sqlite.exec(`DELETE FROM headcount_monthly`);
  sqlite.exec(`DELETE FROM concentration_monthly`);
  sqlite.exec(`DELETE FROM bot_ratio`);
  sqlite.exec(`DELETE FROM pr_turnaround`);
  sqlite.exec(`DELETE FROM contributors`);
  sqlite.exec(`DELETE FROM rolling_comparisons`);
  sqlite.exec(`DELETE FROM ramp_up`);
  sqlite.exec(`DELETE FROM cohort_metrics`);
  sqlite.exec(`DELETE FROM snapshots`);
  sqlite.exec(`DELETE FROM orgs`);

  bundle = makePhase94Bundle();
  const zipBuf = bundleToZip(bundle);

  // Step 1: parseZipBundle — deserializes ZIP back to raw JSON shape
  const parsed = parseZipBundle(zipBuf);

  // Step 2: importBundle — validates, creates org, inserts all rows
  const result = importBundle(parsed, null, 'batch', 'Test Org');
  orgId     = result.orgId;
  snapshotId = result.snapshotId;

  // Step 3: Reconstruct via the Hono route — exercises DB → ExportBundle mapping
  const app = getApp();
  const res = await app.request(`/api/orgs/${orgId}/snapshots/${snapshotId}/data`);
  expect(res.status).toBe(200);
  reconstructed = await res.json() as ExportBundle;
});

// ── round-trip: Phase 9.4 concentration ──────────────────────────────────────

describe('round-trip: Phase 9.4 concentration', () => {
  it('row count matches original', () => {
    expect(reconstructed.concentrationMonthly.length).toBe(bundle.concentrationMonthly.length);
  });

  it('every field survives for the first row', () => {
    const orig = bundle.concentrationMonthly[0];
    const rec  = reconstructed.concentrationMonthly.find(
      r => r.month === orig.month && r.basis === orig.basis,
    );
    expect(rec).toBeDefined();
    expect(rec!.month).toBe(orig.month);
    expect(rec!.basis).toBe(orig.basis);
    expect(rec!.top1Share).toBeCloseTo(orig.top1Share ?? 0, 5);
    expect(rec!.top3Share).toBeCloseTo(orig.top3Share ?? 0, 5);
    expect(rec!.top5Share).toBeCloseTo(orig.top5Share ?? 0, 5);
    expect(rec!.hhi).toBeCloseTo(orig.hhi ?? 0, 5);
    expect(rec!.gini).toBeCloseTo(orig.gini ?? 0, 5);
    expect(rec!.busFactor).toBe(orig.busFactor);
    expect(rec!.activeDevs).toBe(orig.activeDevs);
    expect(rec!.topContributor).toBe(orig.topContributor);
  });

  it('deep equality over ALL rows (sorted by month+basis, numeric tolerance)', () => {
    const sortKey = (r: ConcentrationMonthlyRow) => `${r.month}:${r.basis}`;
    const origSorted = [...bundle.concentrationMonthly].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const recSorted  = [...reconstructed.concentrationMonthly].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(recSorted.length).toBe(origSorted.length);
    for (let i = 0; i < origSorted.length; i++) {
      expect(recSorted[i]).toMatchObject({
        month:          origSorted[i].month,
        basis:          origSorted[i].basis,
        busFactor:      origSorted[i].busFactor,
        activeDevs:     origSorted[i].activeDevs,
        topContributor: origSorted[i].topContributor,
      });
      expect(recSorted[i].top1Share).toBeCloseTo(origSorted[i].top1Share ?? 0, 5);
      expect(recSorted[i].hhi).toBeCloseTo(origSorted[i].hhi ?? 0, 5);
      expect(recSorted[i].gini).toBeCloseTo(origSorted[i].gini ?? 0, 5);
    }
  });
});

// ── round-trip: Phase 9.4 headcount ──────────────────────────────────────────

describe('round-trip: Phase 9.4 headcount', () => {
  it('row count matches original', () => {
    expect(reconstructed.headcountMonthly.length).toBe(bundle.headcountMonthly.length);
  });

  it('every field survives for the first row', () => {
    const orig = bundle.headcountMonthly[0];
    const rec  = reconstructed.headcountMonthly.find(r => r.month === orig.month);
    expect(rec).toBeDefined();
    expect(rec!.month).toBe(orig.month);
    expect(rec!.activeDevs).toBe(orig.activeDevs);
    expect(rec!.totalPrs).toBe(orig.totalPrs);
    expect(rec!.totalCommits).toBe(orig.totalCommits);
    expect(rec!.prsPerDev).toBeCloseTo(orig.prsPerDev ?? 0, 5);
    expect(rec!.commitsPerDev).toBeCloseTo(orig.commitsPerDev ?? 0, 5);
  });

  it('deep equality over ALL rows (sorted by month, numeric tolerance)', () => {
    const sortKey = (r: HeadcountMonthlyRow) => r.month;
    const origSorted = [...bundle.headcountMonthly].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const recSorted  = [...reconstructed.headcountMonthly].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(recSorted.length).toBe(origSorted.length);
    for (let i = 0; i < origSorted.length; i++) {
      expect(recSorted[i]).toMatchObject({
        month:        origSorted[i].month,
        activeDevs:   origSorted[i].activeDevs,
        totalPrs:     origSorted[i].totalPrs,
        totalCommits: origSorted[i].totalCommits,
      });
      expect(recSorted[i].prsPerDev).toBeCloseTo(origSorted[i].prsPerDev ?? 0, 5);
      expect(recSorted[i].commitsPerDev).toBeCloseTo(origSorted[i].commitsPerDev ?? 0, 5);
    }
  });
});

// ── round-trip: Phase 9.4 periodMetrics ──────────────────────────────────────

describe('round-trip: Phase 9.4 periodMetrics', () => {
  it('array length matches (2 periods: Before AI + After AI)', () => {
    expect(reconstructed.periodMetrics?.length).toBe(bundle.periodMetrics?.length);
    expect(reconstructed.periodMetrics?.length).toBe(2);
  });

  it('period.label and period dates survive for both periods', () => {
    const orig0 = bundle.periodMetrics![0];
    const rec0  = reconstructed.periodMetrics![0];
    expect(rec0.period.label).toBe(orig0.period.label);
    expect(rec0.period.startDate).toBe(orig0.period.startDate);
    expect(rec0.period.endDate).toBe(orig0.period.endDate);

    const orig1 = bundle.periodMetrics![1];
    const rec1  = reconstructed.periodMetrics![1];
    expect(rec1.period.label).toBe(orig1.period.label);
    expect(rec1.period.startDate).toBe(orig1.period.startDate);
    expect(rec1.period.endDate).toBe(orig1.period.endDate);
  });

  it('metrics Record survives with numeric tolerance (REAL column precision)', () => {
    const orig0 = bundle.periodMetrics![0];
    const rec0  = reconstructed.periodMetrics![0];
    expect(rec0.metrics.avgCommitSize).toBeCloseTo(orig0.metrics.avgCommitSize as number, 5);
    expect(rec0.metrics.prFrequency).toBeCloseTo(orig0.metrics.prFrequency as number, 5);
    expect(rec0.metrics.rampUpSpeed).toBeCloseTo(orig0.metrics.rampUpSpeed as number, 5);
    expect(rec0.metrics.activeContributors).toBe(orig0.metrics.activeContributors);
  });

  it('periodMetrics deep-equals via JSON round-trip (full structural check)', () => {
    // period_metrics is stored as a JSON blob — any structural diff fails this.
    // Uses JSON round-trip on both sides to normalize undefined/null equivalence.
    expect(JSON.parse(JSON.stringify(reconstructed.periodMetrics)))
      .toEqual(JSON.parse(JSON.stringify(bundle.periodMetrics)));
  });
});

// ── round-trip: Phase 9.4 empty-data path (H2 negative case) ─────────────────

describe('round-trip: Phase 9.4 empty-data path (H2 negative)', () => {
  it('empty concentrationMonthly / headcountMonthly / null periodMetrics survive as empty / null', async () => {
    // Clear existing data so this import gets a fresh unique content hash
    sqlite.exec(`DELETE FROM developer_monthly`);
    sqlite.exec(`DELETE FROM period_metrics`);
    sqlite.exec(`DELETE FROM headcount_monthly`);
    sqlite.exec(`DELETE FROM concentration_monthly`);
    sqlite.exec(`DELETE FROM bot_ratio`);
    sqlite.exec(`DELETE FROM pr_turnaround`);
    sqlite.exec(`DELETE FROM contributors`);
    sqlite.exec(`DELETE FROM rolling_comparisons`);
    sqlite.exec(`DELETE FROM ramp_up`);
    sqlite.exec(`DELETE FROM cohort_metrics`);
    sqlite.exec(`DELETE FROM snapshots`);
    sqlite.exec(`DELETE FROM orgs`);

    // Bundle with no Phase 9.4 data (simulates main DB with no commits in range)
    const emptyBundle = makePhase94Bundle({
      concentrationMonthly: [],
      headcountMonthly: [],
      periodMetrics: null,
      developerMonthly: [],
    });
    const zipBuf = bundleToZip(emptyBundle);
    const parsed = parseZipBundle(zipBuf);
    const result = importBundle(parsed, null, 'batch', 'Empty Test Org');

    const app = getApp();
    const res = await app.request(
      `/api/orgs/${result.orgId}/snapshots/${result.snapshotId}/data`,
    );
    expect(res.status).toBe(200);
    const rec = await res.json() as ExportBundle;

    // H2 fix verification: the endpoint must return empty arrays (not hardcoded stubs)
    expect(rec.concentrationMonthly).toEqual([]);
    expect(rec.headcountMonthly).toEqual([]);
    expect(rec.periodMetrics).toBeNull();
    expect(rec.developerMonthly).toEqual([]);
  });
});

// ── round-trip: Phase 9.5 developerMonthly ───────────────────────────────────

describe('round-trip: Phase 9.5 developerMonthly', () => {
  it('row count matches original', () => {
    expect(reconstructed.developerMonthly.length).toBe(bundle.developerMonthly.length);
  });

  it('every field survives for the first row', () => {
    const orig = bundle.developerMonthly[0];
    const rec = reconstructed.developerMonthly.find(
      r => r.authorLogin === orig.authorLogin && r.month === orig.month,
    );
    expect(rec).toBeDefined();
    expect(rec!.authorLogin).toBe(orig.authorLogin);
    expect(rec!.month).toBe(orig.month);
    expect(rec!.prCount).toBe(orig.prCount);
    expect(rec!.commitCount).toBe(orig.commitCount);
    expect(rec!.meanLinesPerCommit).toBeCloseTo(orig.meanLinesPerCommit ?? 0, 5);
    expect(rec!.medianLinesPerCommit).toBeCloseTo(orig.medianLinesPerCommit ?? 0, 5);
    expect(rec!.meanFilesPerCommit).toBeCloseTo(orig.meanFilesPerCommit ?? 0, 5);
    expect(rec!.medianFilesPerCommit).toBeCloseTo(orig.medianFilesPerCommit ?? 0, 5);
  });

  it('null fields survive as null (REAL nullability preserved)', () => {
    const orig = bundle.developerMonthly.find(
      r => r.meanLinesPerCommit === null,
    );
    expect(orig).toBeDefined();
    const rec = reconstructed.developerMonthly.find(
      r => r.authorLogin === orig!.authorLogin && r.month === orig!.month,
    );
    expect(rec).toBeDefined();
    expect(rec!.meanLinesPerCommit).toBeNull();
    expect(rec!.medianLinesPerCommit).toBeNull();
    expect(rec!.meanFilesPerCommit).toBeNull();
    expect(rec!.medianFilesPerCommit).toBeNull();
  });

  it('deep equality over ALL rows (sorted by authorLogin+month, numeric tolerance)', () => {
    const sortKey = (r: DeveloperMonthlyRow) => `${r.authorLogin}:${r.month}`;
    const origSorted = [...bundle.developerMonthly].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const recSorted = [...reconstructed.developerMonthly].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(recSorted.length).toBe(origSorted.length);
    for (let i = 0; i < origSorted.length; i++) {
      expect(recSorted[i]).toMatchObject({
        authorLogin: origSorted[i].authorLogin,
        month: origSorted[i].month,
        prCount: origSorted[i].prCount,
        commitCount: origSorted[i].commitCount,
      });
      // Sized-stat fields are nullable — match null-vs-null exactly, otherwise tolerance
      if (origSorted[i].meanLinesPerCommit === null) {
        expect(recSorted[i].meanLinesPerCommit).toBeNull();
      } else {
        expect(recSorted[i].meanLinesPerCommit).toBeCloseTo(origSorted[i].meanLinesPerCommit!, 5);
      }
    }
  });
});

// ── D-17 graceful degradation: pre-9.5 bundles missing developerMonthly ──────

describe('imports pre-9.5 bundles missing developerMonthly without error (D-17)', () => {
  it('bundle without developerMonthly section imports successfully and reconstructs as []', async () => {
    // Clear existing data so this import gets a fresh unique content hash
    sqlite.exec(`DELETE FROM developer_monthly`);
    sqlite.exec(`DELETE FROM period_metrics`);
    sqlite.exec(`DELETE FROM headcount_monthly`);
    sqlite.exec(`DELETE FROM concentration_monthly`);
    sqlite.exec(`DELETE FROM bot_ratio`);
    sqlite.exec(`DELETE FROM pr_turnaround`);
    sqlite.exec(`DELETE FROM contributors`);
    sqlite.exec(`DELETE FROM rolling_comparisons`);
    sqlite.exec(`DELETE FROM ramp_up`);
    sqlite.exec(`DELETE FROM cohort_metrics`);
    sqlite.exec(`DELETE FROM snapshots`);
    sqlite.exec(`DELETE FROM orgs`);

    // Build a pre-9.5 ZIP — same as bundleToZip but WITHOUT developer-monthly.json.
    // This simulates an older-tool-version bundle that pre-dates the developerMonthly section.
    const orig = makePhase94Bundle({ developerMonthly: [] });
    const json = (data: unknown) => strToU8(JSON.stringify(data, null, 2));
    const files: Record<string, Uint8Array> = {
      'metadata.json': json(orig.metadata),
      'cohort-commits.json': json(orig.cohortCommits),
      'cohort-prs.json': json(orig.cohortPrs),
      'ramp-up.json': json(orig.rampUp),
      'contributors.json': json(orig.contributors),
      'pr-turnaround.json': json(orig.prTurnaround),
      'bot-ratio.json': json(orig.botRatio),
    };
    if (orig.concentrationMonthly.length > 0) files['concentration-monthly.json'] = json(orig.concentrationMonthly);
    if (orig.headcountMonthly.length > 0) files['headcount-monthly.json'] = json(orig.headcountMonthly);
    if (orig.periodMetrics) files['period-metrics.json'] = json(orig.periodMetrics);
    // Intentionally omit developer-monthly.json to mimic pre-9.5 bundles
    const zipBuf = Buffer.from(zipSync(files));

    const parsed = parseZipBundle(zipBuf);
    // The graceful-degradation contract: parseZipBundle returns developerMonthly: []
    expect((parsed as { developerMonthly: unknown[] }).developerMonthly).toEqual([]);

    const result = importBundle(parsed, null, 'batch', 'Pre-9.5 Test Org');
    expect(result.snapshotId).toBeGreaterThan(0);

    const app = getApp();
    const res = await app.request(
      `/api/orgs/${result.orgId}/snapshots/${result.snapshotId}/data`,
    );
    expect(res.status).toBe(200);
    const rec = await res.json() as ExportBundle;
    expect(rec.developerMonthly).toEqual([]);
  });
});
