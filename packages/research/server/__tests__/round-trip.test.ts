/**
 * Round-trip tests: generate → ZIP → parse → import → read back → verify.
 *
 * These tests use the EXACT same CREATE TABLE SQL as the server (index.ts)
 * to catch schema mismatches. If a column is missing from the CREATE TABLE
 * but present in the Drizzle schema, the import will fail here the same way
 * it would fail in production.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { zipSync, strToU8 } from 'fflate';
import * as schema from '../db/schema.js';
import type { ExportBundle } from '@shared/export-types.js';

// ── Schema SQL — copied from server/index.ts (the single source of truth) ──
// If this ever drifts from index.ts, that's a bug. Keep them in sync.
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
`;

// ── Test helpers ─────────────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(CREATE_TABLES_SQL);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

/** Minimal valid ExportBundle with all sections populated */
function makeFullBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    metadata: {
      exportTimestamp: '2026-04-10T12:00:00Z',
      startDate: '2025-04-01T00:00:00Z',
      endDate: '2026-04-01T00:00:00Z',
      aiMarkerDate: '2025-10-15',
      tenureMode: 'global',
      repoIds: [1, 2],
      repoNames: ['org/repo-1', 'org/repo-2'],
      cohortConfig: {
        thresholds: [
          { maxMonths: 3, key: 'new', label: '0–3 mo', color: '#4a90d9' },
          { maxMonths: 12, key: 'mid', label: '3–12 mo', color: '#82b366' },
          { maxMonths: null, key: 'senior', label: '1 yr+', color: '#d9a441' },
        ],
      },
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: 'org',
    },
    cohortCommits: [
      { cohort: 'new', period: 'before', periodMonth: '2025-06', avgLinesAdded: 42.5, avgLinesDeleted: 12.3, avgFilesChanged: 3.1, totalCount: 15, contributorCount: 3 },
      { cohort: 'new', period: 'after', periodMonth: '2025-12', avgLinesAdded: 88.2, avgLinesDeleted: 22.1, avgFilesChanged: 5.4, totalCount: 28, contributorCount: 4 },
      { cohort: 'senior', period: 'all', periodMonth: '2025-09', avgLinesAdded: 120.0, avgLinesDeleted: 45.0, avgFilesChanged: 8.0, totalCount: 50, contributorCount: 5 },
    ],
    cohortPrs: [
      { cohort: 'mid', period: 'before', periodMonth: '2025-07', avgLinesAdded: 200, avgLinesDeleted: 80, avgFilesChanged: 10, totalCount: 8, contributorCount: 2 },
    ],
    rampUp: [
      { weekIndex: 0, avgLinesChanged: 15.5, avgFilesChanged: 1.2, contributionCount: 3, contributorCount: 2, joinPeriod: 'before' },
      { weekIndex: 1, avgLinesChanged: 32.8, avgFilesChanged: 2.5, contributionCount: 7, contributorCount: 2, joinPeriod: 'before' },
      { weekIndex: 0, avgLinesChanged: 45.0, avgFilesChanged: 3.0, contributionCount: 5, contributorCount: 3, joinPeriod: 'after' },
    ],
    // rolling stored as JSON blob — shape doesn't need to match RollingComparisonResult exactly
    rolling: {
      granularity: 'month',
      current: {
        label: 'Oct 2025', startDate: '2025-10-01', endDate: '2025-10-31',
        avgCommitSize: 62.1, avgPrSize: 145.0, commitCount: 145, prCount: 38,
        avgFilesPerCommit: 3.2, avgFilesPerPr: 7.5, dailyAvgCommitSize: 2.0,
        dailyAvgPrSize: 4.7, dailyCommitCount: 4.7, dailyPrCount: 1.2,
      },
      prior: {
        label: 'Sep 2025', startDate: '2025-09-01', endDate: '2025-09-30',
        avgCommitSize: 55.2, avgPrSize: 130.0, commitCount: 120, prCount: 30,
        avgFilesPerCommit: 2.8, avgFilesPerPr: 6.5, dailyAvgCommitSize: 1.8,
        dailyAvgPrSize: 4.3, dailyCommitCount: 4.0, dailyPrCount: 1.0,
      },
      changes: { commitSize: 12.5, prSize: 11.5, commitFrequency: null, prFrequency: null },
    },
    contributors: [
      {
        authorLogin: 'alice',
        cohort: 'new',
        firstCommitAt: '2025-08-15T10:00:00Z',
        pre: { authorLogin: 'alice', cohort: 'new', totalCommits: 10, totalPrs: 3, avgLinesAdded: 30, avgLinesDeleted: 10, avgFilesChanged: 2, firstCommitAt: '2025-08-15T10:00:00Z' },
        post: { authorLogin: 'alice', cohort: 'new', totalCommits: 25, totalPrs: 8, avgLinesAdded: 65, avgLinesDeleted: 20, avgFilesChanged: 4, firstCommitAt: '2025-08-15T10:00:00Z' },
      },
      {
        authorLogin: 'bob',
        cohort: 'senior',
        firstCommitAt: '2023-01-10T08:00:00Z',
        pre: { authorLogin: 'bob', cohort: 'senior', totalCommits: 200, totalPrs: 50, avgLinesAdded: 80, avgLinesDeleted: 40, avgFilesChanged: 6, firstCommitAt: '2023-01-10T08:00:00Z' },
        post: null,
      },
      {
        authorLogin: 'charlie',
        cohort: 'mid',
        firstCommitAt: '2025-03-01T00:00:00Z',  // non-null: ContributorBeforeAfterStats.firstCommitAt is string
        pre: null,
        post: { authorLogin: 'charlie', cohort: 'mid', totalCommits: 15, totalPrs: 5, avgLinesAdded: 45, avgLinesDeleted: 15, avgFilesChanged: 3, firstCommitAt: '2025-03-01T00:00:00Z' },
      },
    ],
    prTurnaround: [
      { periodMonth: '2025-08', avgHoursToMerge: 4.2, medianHoursToMerge: 2.1, prCount: 12 },
      { periodMonth: '2025-09', avgHoursToMerge: 3.8, medianHoursToMerge: 1.9, prCount: 18 },
    ],
    botRatio: [
      { periodMonth: '2025-08', botCommits: 5, humanCommits: 95, totalCommits: 100, botPercentage: 5.0 },
      { periodMonth: '2025-09', botCommits: 12, humanCommits: 118, totalCommits: 130, botPercentage: 9.23 },
    ],
    executiveSummary: {
      totalCommits: 450,
      activeContributors: 12,
      rampUpTrend: 'faster',
      aiAdoptionDelta: '+23% commit velocity',
    },
    periodMetrics: [
      {
        period: { startDate: '2025-04-01', endDate: '2025-10-15', label: 'Before AI' },
        metrics: { avgCommitSize: 55.2, prFrequency: 3.1, rampUpSpeed: 4.5, activeContributors: 8 },
      },
      {
        period: { startDate: '2025-10-15', endDate: '2026-04-01', label: 'After AI', markerDate: '2025-10-15' },
        metrics: { avgCommitSize: 72.8, prFrequency: 4.8, rampUpSpeed: 2.8, activeContributors: 12 },
      },
    ],
    concentrationMonthly: [],
    headcountMonthly: [],
    ...overrides,
  };
}

/** Convert ExportBundle to ZIP bytes (same logic as ExportModal + generate-test-zips) */
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
  if (bundle.rolling) files['rolling-comparison.json'] = json(bundle.rolling);
  if (bundle.executiveSummary) files['executive-summary.json'] = json(bundle.executiveSummary);
  if (bundle.periodMetrics) files['period-metrics.json'] = json(bundle.periodMetrics);
  if (bundle.concentrationMonthly.length > 0) files['concentration-monthly.json'] = json(bundle.concentrationMonthly);
  if (bundle.headcountMonthly.length > 0) files['headcount-monthly.json'] = json(bundle.headcountMonthly);
  return Buffer.from(zipSync(files));
}

/**
 * Import a bundle into a test DB using the same logic as import-service.ts.
 * We re-implement importBundle here because the real one uses the singleton
 * db from client.ts. This ensures we test against the actual SQL schema.
 */
function importBundleIntoDb(
  testDb: ReturnType<typeof drizzle<typeof schema>>,
  bundle: ExportBundle,
  orgLabel: string,
): { orgId: number; snapshotId: number } {
  const orgResult = testDb.insert(schema.orgs).values({
    label: orgLabel,
    importSource: 'file',
    createdAt: Date.now(),
  }).returning({ id: schema.orgs.id }).get();
  const orgId = orgResult.id;

  const snapshotId = testDb.transaction(() => {
    const snap = testDb.insert(schema.snapshots).values({
      orgId,
      importTimestamp: Date.now(),
      metadataJson: JSON.stringify(bundle.metadata),
      toolVersion: bundle.metadata.toolVersion,
      startDate: bundle.metadata.startDate,
      endDate: bundle.metadata.endDate,
      aiMarkerDate: bundle.metadata.aiMarkerDate,
      contributorCount: new Set(bundle.contributors.map(c => c.authorLogin)).size,
      repoCount: bundle.metadata.repoNames.length,
      contentHash: 'test-hash',
      executiveSummaryJson: bundle.executiveSummary ? JSON.stringify(bundle.executiveSummary) : null,
    }).returning({ id: schema.snapshots.id }).get();

    const snapId = snap.id;

    if (bundle.cohortCommits.length > 0) {
      testDb.insert(schema.cohortMetrics).values(
        bundle.cohortCommits.map(row => ({
          snapshotId: snapId, orgId, metricType: 'commits' as const,
          cohort: row.cohort, period: row.period, periodMonth: row.periodMonth,
          avgLinesAdded: row.avgLinesAdded, avgLinesDeleted: row.avgLinesDeleted,
          avgFilesChanged: row.avgFilesChanged, totalCount: row.totalCount,
          contributorCount: row.contributorCount,
        }))
      ).run();
    }

    if (bundle.cohortPrs.length > 0) {
      testDb.insert(schema.cohortMetrics).values(
        bundle.cohortPrs.map(row => ({
          snapshotId: snapId, orgId, metricType: 'prs' as const,
          cohort: row.cohort, period: row.period, periodMonth: row.periodMonth,
          avgLinesAdded: row.avgLinesAdded, avgLinesDeleted: row.avgLinesDeleted,
          avgFilesChanged: row.avgFilesChanged, totalCount: row.totalCount,
          contributorCount: row.contributorCount,
        }))
      ).run();
    }

    if (bundle.rampUp.length > 0) {
      testDb.insert(schema.rampUp).values(
        bundle.rampUp.map(row => ({
          snapshotId: snapId, orgId,
          weekIndex: row.weekIndex, joinPeriod: row.joinPeriod,
          avgLinesChanged: row.avgLinesChanged, avgFilesChanged: row.avgFilesChanged,
          contributionCount: row.contributionCount, contributorCount: row.contributorCount,
        }))
      ).run();
    }

    if (bundle.rolling !== null) {
      testDb.insert(schema.rollingComparisons).values({
        snapshotId: snapId, orgId, dataJson: JSON.stringify(bundle.rolling),
      }).run();
    }

    if (bundle.contributors.length > 0) {
      testDb.insert(schema.contributors).values(
        bundle.contributors.map(row => ({
          snapshotId: snapId, orgId,
          authorLogin: row.authorLogin, cohort: row.cohort,
          firstCommitAt: row.firstCommitAt ?? null,
          preJson: row.pre ? JSON.stringify(row.pre) : null,
          postJson: row.post ? JSON.stringify(row.post) : null,
        }))
      ).run();
    }

    if (bundle.prTurnaround.length > 0) {
      testDb.insert(schema.prTurnaround).values(
        bundle.prTurnaround.map(row => ({
          snapshotId: snapId, orgId,
          periodMonth: row.periodMonth, avgHoursToMerge: row.avgHoursToMerge,
          medianHoursToMerge: row.medianHoursToMerge, prCount: row.prCount,
        }))
      ).run();
    }

    if (bundle.botRatio.length > 0) {
      testDb.insert(schema.botRatio).values(
        bundle.botRatio.map(row => ({
          snapshotId: snapId, orgId,
          periodMonth: row.periodMonth, botCommits: row.botCommits,
          humanCommits: row.humanCommits, totalCommits: row.totalCommits,
          botPercentage: row.botPercentage,
        }))
      ).run();
    }

    return snapId;
  });

  return { orgId, snapshotId };
}

/** Read back all data for a snapshot — same logic as GET /api/orgs/:orgId/snapshots/:snapshotId/data */
function readBackBundle(
  testDb: ReturnType<typeof drizzle<typeof schema>>,
  snapshotId: number,
): Record<string, unknown> {
  const snapshot = testDb.select().from(schema.snapshots).where(eq(schema.snapshots.id, snapshotId)).get()!;

  const commits = testDb.select().from(schema.cohortMetrics).where(eq(schema.cohortMetrics.snapshotId, snapshotId)).all();
  const rampUpRows = testDb.select().from(schema.rampUp).where(eq(schema.rampUp.snapshotId, snapshotId)).all();
  const rollingRow = testDb.select().from(schema.rollingComparisons).where(eq(schema.rollingComparisons.snapshotId, snapshotId)).get();
  const contributorRows = testDb.select().from(schema.contributors).where(eq(schema.contributors.snapshotId, snapshotId)).all();
  const prTurnaroundRows = testDb.select().from(schema.prTurnaround).where(eq(schema.prTurnaround.snapshotId, snapshotId)).all();
  const botRatioRows = testDb.select().from(schema.botRatio).where(eq(schema.botRatio.snapshotId, snapshotId)).all();

  return {
    metadata: JSON.parse(snapshot.metadataJson),
    cohortCommits: commits.filter(r => r.metricType === 'commits').map(({ metricType: _m, id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    cohortPrs: commits.filter(r => r.metricType === 'prs').map(({ metricType: _m, id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    rampUp: rampUpRows.map(({ id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    rolling: rollingRow ? JSON.parse(rollingRow.dataJson) : null,
    contributors: contributorRows.map(r => ({
      authorLogin: r.authorLogin, cohort: r.cohort, firstCommitAt: r.firstCommitAt,
      pre: r.preJson ? JSON.parse(r.preJson) : null,
      post: r.postJson ? JSON.parse(r.postJson) : null,
    })),
    prTurnaround: prTurnaroundRows.map(({ id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    botRatio: botRatioRows.map(({ id: _id, snapshotId: _s, orgId: _o, ...rest }) => rest),
    executiveSummary: snapshot.executiveSummaryJson ? JSON.parse(snapshot.executiveSummaryJson) : null,
    periodMetrics: null,        // not persisted in snapshots table (Phase 9.4 D-13)
    concentrationMonthly: [],
    headcountMonthly: [],
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('schema creation', () => {
  it('creates all 8 tables with correct columns', () => {
    const { sqlite } = createTestDb();
    const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name).sort();
    expect(tableNames).toEqual([
      'bot_ratio', 'cohort_metrics', 'contributors', 'orgs',
      'pr_turnaround', 'ramp_up', 'rolling_comparisons', 'snapshots',
    ]);
  });

  it('cohort_metrics has org_id column', () => {
    const { sqlite } = createTestDb();
    const cols = sqlite.prepare("PRAGMA table_info(cohort_metrics)").all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('org_id');
  });

  it('ramp_up has org_id column', () => {
    const { sqlite } = createTestDb();
    const cols = sqlite.prepare("PRAGMA table_info(ramp_up)").all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('org_id');
  });

  it('contributors has author_login, cohort, first_commit_at, pre_json, post_json columns', () => {
    const { sqlite } = createTestDb();
    const cols = sqlite.prepare("PRAGMA table_info(contributors)").all() as Array<{ name: string }>;
    const names = cols.map(c => c.name);
    expect(names).toContain('org_id');
    expect(names).toContain('author_login');
    expect(names).toContain('cohort');
    expect(names).toContain('first_commit_at');
    expect(names).toContain('pre_json');
    expect(names).toContain('post_json');
  });

  it('all child tables have org_id column', () => {
    const { sqlite } = createTestDb();
    const childTables = ['cohort_metrics', 'ramp_up', 'rolling_comparisons', 'contributors', 'pr_turnaround', 'bot_ratio'];
    for (const table of childTables) {
      const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      expect(cols.map(c => c.name), `${table} should have org_id`).toContain('org_id');
    }
  });
});

describe('full round-trip: bundle → import → read back', () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    const { db } = createTestDb();
    testDb = db;
  });

  it('preserves all cohort commit fields', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.cohortCommits).toHaveLength(3);
    const first = (result.cohortCommits as Array<Record<string, unknown>>)[0];
    expect(first.cohort).toBe('new');
    expect(first.period).toBe('before');
    expect(first.periodMonth).toBe('2025-06');
    expect(first.avgLinesAdded).toBeCloseTo(42.5);
    expect(first.avgLinesDeleted).toBeCloseTo(12.3);
    expect(first.avgFilesChanged).toBeCloseTo(3.1);
    expect(first.totalCount).toBe(15);
    expect(first.contributorCount).toBe(3);
  });

  it('preserves all cohort PR fields', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.cohortPrs).toHaveLength(1);
    const pr = (result.cohortPrs as Array<Record<string, unknown>>)[0];
    expect(pr.cohort).toBe('mid');
    expect(pr.period).toBe('before');
    expect(pr.avgLinesAdded).toBe(200);
  });

  it('preserves all ramp-up fields', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.rampUp).toHaveLength(3);
    const first = (result.rampUp as Array<Record<string, unknown>>)[0];
    expect(first.weekIndex).toBe(0);
    expect(first.avgLinesChanged).toBeCloseTo(15.5);
    expect(first.avgFilesChanged).toBeCloseTo(1.2);
    expect(first.contributionCount).toBe(3);
    expect(first.contributorCount).toBe(2);
    expect(first.joinPeriod).toBe('before');
  });

  it('preserves rolling comparison JSON', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.rolling).not.toBeNull();
    const rolling = result.rolling as Record<string, unknown>;
    expect(rolling.granularity).toBe('month');
    expect(rolling.current).toBeDefined();
    expect(rolling.prior).toBeDefined();
    expect((rolling.current as Record<string, unknown>).label).toBe('Oct 2025');
  });

  it('preserves all contributor fields including pre/post JSON', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.contributors).toHaveLength(3);
    const contributors = result.contributors as Array<Record<string, unknown>>;

    // alice has both pre and post
    const alice = contributors.find(c => c.authorLogin === 'alice')!;
    expect(alice.cohort).toBe('new');
    expect(alice.firstCommitAt).toBe('2025-08-15T10:00:00Z');
    expect(alice.pre).not.toBeNull();
    expect(alice.post).not.toBeNull();
    expect((alice.pre as Record<string, unknown>).totalCommits).toBe(10);
    expect((alice.post as Record<string, unknown>).totalCommits).toBe(25);

    // bob has pre only
    const bob = contributors.find(c => c.authorLogin === 'bob')!;
    expect(bob.pre).not.toBeNull();
    expect(bob.post).toBeNull();
    expect((bob.pre as Record<string, unknown>).totalCommits).toBe(200);

    // charlie has post only; firstCommitAt is the stored value (non-null per ContributorBeforeAfterStats type)
    const charlie = contributors.find(c => c.authorLogin === 'charlie')!;
    expect(charlie.firstCommitAt).toBe('2025-03-01T00:00:00Z');
    expect(charlie.pre).toBeNull();
    expect(charlie.post).not.toBeNull();
  });

  it('preserves all PR turnaround fields', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.prTurnaround).toHaveLength(2);
    const first = (result.prTurnaround as Array<Record<string, unknown>>)[0];
    expect(first.periodMonth).toBe('2025-08');
    expect(first.avgHoursToMerge).toBeCloseTo(4.2);
    expect(first.medianHoursToMerge).toBeCloseTo(2.1);
    expect(first.prCount).toBe(12);
  });

  it('preserves all bot ratio fields', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.botRatio).toHaveLength(2);
    const second = (result.botRatio as Array<Record<string, unknown>>)[1];
    expect(second.periodMonth).toBe('2025-09');
    expect(second.botCommits).toBe(12);
    expect(second.humanCommits).toBe(118);
    expect(second.totalCommits).toBe(130);
    expect(second.botPercentage).toBeCloseTo(9.23);
  });

  it('preserves executive summary JSON', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    const es = result.executiveSummary as Record<string, unknown>;
    expect(es.totalCommits).toBe(450);
    expect(es.activeContributors).toBe(12);
    expect(es.rampUpTrend).toBe('faster');
    expect(es.aiAdoptionDelta).toBe('+23% commit velocity');
  });

  it('preserves periodMetrics (null — not persisted in snapshots table)', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    // periodMetrics is not persisted in the snapshots table (Phase 9.4 D-13)
    expect(result.periodMetrics).toBeNull();
  });

  it('preserves metadata including all fields', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const result = readBackBundle(testDb, snapshotId);

    const md = result.metadata as Record<string, unknown>;
    expect(md.exportTimestamp).toBe('2026-04-10T12:00:00Z');
    expect(md.startDate).toBe('2025-04-01T00:00:00Z');
    expect(md.endDate).toBe('2026-04-01T00:00:00Z');
    expect(md.aiMarkerDate).toBe('2025-10-15');
    expect(md.tenureMode).toBe('global');
    expect(md.repoIds).toEqual([1, 2]);
    expect(md.repoNames).toEqual(['org/repo-1', 'org/repo-2']);
    expect(md.toolVersion).toBe('1.0.0');
    expect(md.rollingGranularity).toBe('month');
  });

  it('snapshot has correct derived counts', () => {
    const bundle = makeFullBundle();
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Test Org');
    const snap = testDb.select().from(schema.snapshots).where(eq(schema.snapshots.id, snapshotId)).get()!;

    expect(snap.contributorCount).toBe(3); // alice, bob, charlie
    expect(snap.repoCount).toBe(2); // org/repo-1, org/repo-2
    expect(snap.toolVersion).toBe('1.0.0');
    expect(snap.aiMarkerDate).toBe('2025-10-15');
  });
});

describe('ZIP round-trip: bundle → ZIP → parse → import → read back', () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    const { db } = createTestDb();
    testDb = db;
  });

  it('full bundle survives ZIP round-trip with all fields intact', () => {
    const original = makeFullBundle();
    const zipBuffer = bundleToZip(original);

    // Parse ZIP (same as import-service.ts parseZipBundle)
    const { unzipSync, strFromU8: str } = require('fflate');
    const unzipped = unzipSync(new Uint8Array(zipBuffer));
    const readJson = (f: string) => { const d = unzipped[f]; return d ? JSON.parse(str(d)) : null; };

    const parsed = {
      metadata: readJson('metadata.json'),
      cohortCommits: readJson('cohort-commits.json') ?? [],
      cohortPrs: readJson('cohort-prs.json') ?? [],
      rampUp: readJson('ramp-up.json') ?? [],
      rolling: readJson('rolling-comparison.json') ?? null,
      contributors: readJson('contributors.json') ?? [],
      prTurnaround: readJson('pr-turnaround.json') ?? [],
      botRatio: readJson('bot-ratio.json') ?? [],
      executiveSummary: readJson('executive-summary.json') ?? null,
      periodMetrics: readJson('period-metrics.json') ?? null,
      concentrationMonthly: readJson('concentration-monthly.json') ?? [],
      headcountMonthly: readJson('headcount-monthly.json') ?? [],
    } as ExportBundle;

    // Import parsed bundle
    const { snapshotId } = importBundleIntoDb(testDb, parsed, 'ZIP Test Org');
    const result = readBackBundle(testDb, snapshotId);

    // Verify every section matches original
    expect(result.metadata).toEqual(original.metadata);
    expect(result.cohortCommits).toHaveLength(original.cohortCommits.length);
    expect(result.cohortPrs).toHaveLength(original.cohortPrs.length);
    expect(result.rampUp).toHaveLength(original.rampUp.length);
    expect(result.rolling).toEqual(original.rolling);
    expect(result.contributors).toHaveLength(original.contributors.length);
    expect(result.prTurnaround).toHaveLength(original.prTurnaround.length);
    expect(result.botRatio).toHaveLength(original.botRatio.length);
    expect(result.executiveSummary).toEqual(original.executiveSummary);
    // periodMetrics not persisted in snapshots table (Phase 9.4 D-13)
    expect(result.periodMetrics).toBeNull();
  });
});

describe('edge cases', () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    const { db } = createTestDb();
    testDb = db;
  });

  it('handles bundle with null optional sections', () => {
    const bundle = makeFullBundle({
      rolling: null,
      executiveSummary: null,
      periodMetrics: null,
    });
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Null Optionals');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.rolling).toBeNull();
    expect(result.executiveSummary).toBeNull();
    expect(result.periodMetrics).toBeNull();
    // Other sections still intact
    expect(result.cohortCommits).toHaveLength(3);
    expect(result.contributors).toHaveLength(3);
  });

  it('handles bundle with empty arrays', () => {
    const bundle = makeFullBundle({
      cohortCommits: [],
      cohortPrs: [],
      rampUp: [],
      contributors: [],
      prTurnaround: [],
      botRatio: [],
    });
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Empty Arrays');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.cohortCommits).toEqual([]);
    expect(result.cohortPrs).toEqual([]);
    expect(result.rampUp).toEqual([]);
    expect(result.contributors).toEqual([]);
    expect(result.prTurnaround).toEqual([]);
    expect(result.botRatio).toEqual([]);
    // Optional JSONs still present
    expect(result.executiveSummary).not.toBeNull();
    // periodMetrics not persisted to DB (Phase 9.4 D-13), returns null from readBackBundle
    expect(result.periodMetrics).toBeNull();
  });

  it('handles bundle with null aiMarkerDate (pre-AI control group)', () => {
    const bundle = makeFullBundle();
    bundle.metadata.aiMarkerDate = null;
    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Pre-AI Baseline');
    const snap = testDb.select().from(schema.snapshots).where(eq(schema.snapshots.id, snapshotId)).get()!;
    expect(snap.aiMarkerDate).toBeNull();

    const result = readBackBundle(testDb, snapshotId);
    expect((result.metadata as Record<string, unknown>).aiMarkerDate).toBeNull();
  });

  it('multiple orgs can coexist in the same database', () => {
    const bundle1 = makeFullBundle();
    const bundle2 = makeFullBundle();
    bundle2.metadata.repoNames = ['other-org/repo-a'];

    const { orgId: org1, snapshotId: snap1 } = importBundleIntoDb(testDb, bundle1, 'Org Alpha');
    const { orgId: org2, snapshotId: snap2 } = importBundleIntoDb(testDb, bundle2, 'Org Beta');

    expect(org1).not.toBe(org2);
    expect(snap1).not.toBe(snap2);

    // Each org's data is isolated
    const r1 = readBackBundle(testDb, snap1);
    const r2 = readBackBundle(testDb, snap2);
    expect((r1.metadata as Record<string, unknown>).repoNames).toEqual(['org/repo-1', 'org/repo-2']);
    expect((r2.metadata as Record<string, unknown>).repoNames).toEqual(['other-org/repo-a']);

    // Cohort metrics from org1 don't leak into org2's snapshot
    const org2Commits = testDb.select().from(schema.cohortMetrics).where(eq(schema.cohortMetrics.snapshotId, snap2)).all();
    org2Commits.forEach(c => expect(c.orgId).toBe(org2));
  });

  it('multiple snapshots for the same org', () => {
    const org = testDb.insert(schema.orgs).values({
      label: 'Multi-Snapshot Org', importSource: 'file', createdAt: Date.now(),
    }).returning({ id: schema.orgs.id }).get();

    const bundle1 = makeFullBundle();
    const bundle2 = makeFullBundle();
    bundle2.metadata.exportTimestamp = '2026-05-01T12:00:00Z';
    bundle2.cohortCommits = [
      { cohort: 'new', period: 'after', periodMonth: '2026-01', avgLinesAdded: 200, avgLinesDeleted: 50, avgFilesChanged: 10, totalCount: 40, contributorCount: 6 },
    ];

    // Import both into same org
    const snap1 = testDb.transaction(() => {
      const s = testDb.insert(schema.snapshots).values({
        orgId: org.id, importTimestamp: Date.now(), metadataJson: JSON.stringify(bundle1.metadata),
        toolVersion: '1.0.0', startDate: bundle1.metadata.startDate, endDate: bundle1.metadata.endDate,
        aiMarkerDate: bundle1.metadata.aiMarkerDate, contributorCount: 3, repoCount: 2, contentHash: 'hash1',
        executiveSummaryJson: null,
      }).returning({ id: schema.snapshots.id }).get();

      testDb.insert(schema.cohortMetrics).values(
        bundle1.cohortCommits.map(r => ({ snapshotId: s.id, orgId: org.id, metricType: 'commits' as const, ...r }))
      ).run();
      return s.id;
    });

    const snap2 = testDb.transaction(() => {
      const s = testDb.insert(schema.snapshots).values({
        orgId: org.id, importTimestamp: Date.now() + 1000, metadataJson: JSON.stringify(bundle2.metadata),
        toolVersion: '1.0.0', startDate: bundle2.metadata.startDate, endDate: bundle2.metadata.endDate,
        aiMarkerDate: bundle2.metadata.aiMarkerDate, contributorCount: 3, repoCount: 2, contentHash: 'hash2',
        executiveSummaryJson: null,
      }).returning({ id: schema.snapshots.id }).get();

      testDb.insert(schema.cohortMetrics).values(
        bundle2.cohortCommits.map(r => ({ snapshotId: s.id, orgId: org.id, metricType: 'commits' as const, ...r }))
      ).run();
      return s.id;
    });

    // Both snapshots exist
    const allSnaps = testDb.select().from(schema.snapshots).where(eq(schema.snapshots.orgId, org.id)).all();
    expect(allSnaps).toHaveLength(2);

    // Data is snapshot-isolated
    const r1 = readBackBundle(testDb, snap1);
    const r2 = readBackBundle(testDb, snap2);
    expect(r1.cohortCommits).toHaveLength(3);
    expect(r2.cohortCommits).toHaveLength(1);
  });
});

describe('test data generator round-trip', () => {
  let testDb: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    const { db } = createTestDb();
    testDb = db;
  });

  it('small startup bundle imports and reads back correctly', async () => {
    const { generateSmallStartup } = await import('../services/test-data-generator.js');
    const bundle = generateSmallStartup();

    const zipBuffer = bundleToZip(bundle);
    expect(zipBuffer.length).toBeGreaterThan(0);

    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Small Startup');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.cohortCommits).toHaveLength(bundle.cohortCommits.length);
    expect(result.cohortPrs).toHaveLength(bundle.cohortPrs.length);
    expect(result.rampUp).toHaveLength(bundle.rampUp.length);
    expect(result.contributors).toHaveLength(bundle.contributors.length);
    expect(result.prTurnaround).toHaveLength(bundle.prTurnaround.length);
    expect(result.botRatio).toHaveLength(bundle.botRatio.length);
  });

  it('mid-size company bundle imports and reads back correctly', async () => {
    const { generateMidSizeCompany } = await import('../services/test-data-generator.js');
    const bundle = generateMidSizeCompany();

    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Mid-Size Co');
    const result = readBackBundle(testDb, snapshotId);

    expect(result.cohortCommits).toHaveLength(bundle.cohortCommits.length);
    expect(result.contributors).toHaveLength(bundle.contributors.length);
    expect(result.metadata).toEqual(bundle.metadata);
  });

  it('pre-AI baseline (null aiMarkerDate) imports and reads back correctly', async () => {
    const { generatePreAiBaseline } = await import('../services/test-data-generator.js');
    const bundle = generatePreAiBaseline();

    expect(bundle.metadata.aiMarkerDate).toBeNull();

    const { snapshotId } = importBundleIntoDb(testDb, bundle, 'Pre-AI Baseline');
    const result = readBackBundle(testDb, snapshotId);
    const snap = testDb.select().from(schema.snapshots).where(eq(schema.snapshots.id, snapshotId)).get()!;

    expect(snap.aiMarkerDate).toBeNull();
    expect(result.cohortCommits).toHaveLength(bundle.cohortCommits.length);
    expect(result.periodMetrics).toBeNull(); // pre-AI has no periodMetrics
  });

  it('all 3 test org bundles can coexist in one database', async () => {
    const { generateAllTestOrgs } = await import('../services/test-data-generator.js');
    const testOrgs = generateAllTestOrgs();

    for (const { label, bundle } of testOrgs) {
      importBundleIntoDb(testDb, bundle, label);
    }

    const allOrgs = testDb.select().from(schema.orgs).all();
    expect(allOrgs).toHaveLength(3);

    const allSnapshots = testDb.select().from(schema.snapshots).all();
    expect(allSnapshots).toHaveLength(3);

    // Each snapshot has data
    for (const snap of allSnapshots) {
      const commits = testDb.select().from(schema.cohortMetrics).where(eq(schema.cohortMetrics.snapshotId, snap.id)).all();
      expect(commits.length).toBeGreaterThan(0);
    }
  });
});
