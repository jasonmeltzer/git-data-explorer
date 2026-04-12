import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { validateBundle } from '../services/validation.js';
import { createHash } from 'node:crypto';

// ─── In-memory DB factory ─────────────────────────────────────────────────────

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Create all tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      size_category TEXT,
      industry TEXT,
      ai_tool TEXT,
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
      avg_lines_added REAL NOT NULL,
      avg_lines_deleted REAL NOT NULL,
      avg_files_changed REAL NOT NULL,
      total_count INTEGER NOT NULL,
      contributor_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ramp_up (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      week_index INTEGER NOT NULL,
      avg_lines_changed REAL NOT NULL,
      avg_files_changed REAL NOT NULL,
      contribution_count INTEGER NOT NULL,
      contributor_count INTEGER NOT NULL,
      join_period TEXT NOT NULL
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
      avg_hours_to_merge REAL NOT NULL,
      median_hours_to_merge REAL NOT NULL,
      pr_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bot_ratio (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      period_month TEXT NOT NULL,
      bot_commits INTEGER NOT NULL,
      human_commits INTEGER NOT NULL,
      total_commits INTEGER NOT NULL,
      bot_percentage REAL NOT NULL
    );
  `);

  return drizzle(sqlite, { schema });
}

// ─── Self-contained service functions using injected db ──────────────────────
// These mirror the actual service implementations but accept a db parameter
// for testability without module mocking.

function createOrgWith(
  db: ReturnType<typeof createTestDb>,
  label: string,
  importSource: string,
): number {
  const result = db
    .insert(schema.orgs)
    .values({ label, importSource, createdAt: Date.now() })
    .returning({ id: schema.orgs.id })
    .get();
  return result.id;
}

function getOrgWith(db: ReturnType<typeof createTestDb>, id: number) {
  return db.select().from(schema.orgs).where(eq(schema.orgs.id, id)).get();
}

function getSnapshotsForOrgWith(db: ReturnType<typeof createTestDb>, orgId: number) {
  return db.select().from(schema.snapshots).where(eq(schema.snapshots.orgId, orgId)).all();
}

function deleteSnapshotDataWith(db: ReturnType<typeof createTestDb>, snapshotId: number) {
  db.delete(schema.cohortMetrics).where(eq(schema.cohortMetrics.snapshotId, snapshotId)).run();
  db.delete(schema.rampUp).where(eq(schema.rampUp.snapshotId, snapshotId)).run();
  db.delete(schema.rollingComparisons).where(eq(schema.rollingComparisons.snapshotId, snapshotId)).run();
  db.delete(schema.contributors).where(eq(schema.contributors.snapshotId, snapshotId)).run();
  db.delete(schema.prTurnaround).where(eq(schema.prTurnaround.snapshotId, snapshotId)).run();
  db.delete(schema.botRatio).where(eq(schema.botRatio.snapshotId, snapshotId)).run();
}

function deleteOrgWith(db: ReturnType<typeof createTestDb>, id: number) {
  const orgSnapshots = db
    .select({ id: schema.snapshots.id })
    .from(schema.snapshots)
    .where(eq(schema.snapshots.orgId, id))
    .all();
  for (const s of orgSnapshots) {
    deleteSnapshotDataWith(db, s.id);
  }
  db.delete(schema.snapshots).where(eq(schema.snapshots.orgId, id)).run();
  db.delete(schema.orgs).where(eq(schema.orgs.id, id)).run();
}

function deleteSnapshotWith(db: ReturnType<typeof createTestDb>, snapshotId: number) {
  deleteSnapshotDataWith(db, snapshotId);
  db.delete(schema.snapshots).where(eq(schema.snapshots.id, snapshotId)).run();
}

function importBundleWith(
  db: ReturnType<typeof createTestDb>,
  bundle: unknown,
  orgId: number | null,
  importSource: 'file' | 'gist' | 'url' | 'batch',
  orgLabel?: string,
) {
  const validation = validateBundle(bundle);
  if (!validation.valid || !validation.data) {
    throw new Error(`Invalid bundle: ${validation.errors?.join('; ')}`);
  }

  const data = validation.data;
  const warnings = [...validation.warnings];
  const contentHash = createHash('sha256').update(JSON.stringify(bundle)).digest('hex');

  if (orgId === null) {
    const label =
      orgLabel ??
      (data.metadata.repoNames.length > 0
        ? data.metadata.repoNames.join(', ')
        : `Org-${Date.now()}`);
    orgId = createOrgWith(db, label, importSource);
  }

  // Check for duplicate
  let isDuplicate = false;
  const existing = db
    .select()
    .from(schema.snapshots)
    .where(eq(schema.snapshots.orgId, orgId))
    .all();
  isDuplicate = existing.some((s) => s.contentHash === contentHash);

  const contributorCount = new Set(data.contributors.map((c) => c.authorLogin)).size;
  const repoCount = data.metadata.repoNames.length;

  const snapshotId = db.transaction(() => {
    const snap = db
      .insert(schema.snapshots)
      .values({
        orgId: orgId as number,
        importTimestamp: Date.now(),
        metadataJson: JSON.stringify(data.metadata),
        toolVersion: data.metadata.toolVersion,
        startDate: data.metadata.startDate,
        endDate: data.metadata.endDate,
        aiMarkerDate: data.metadata.aiMarkerDate,
        contributorCount,
        repoCount,
        contentHash,
        executiveSummaryJson: data.executiveSummary ? JSON.stringify(data.executiveSummary) : null,
        beforeAfterJson: data.beforeAfter ? JSON.stringify(data.beforeAfter) : null,
      })
      .returning({ id: schema.snapshots.id })
      .get();

    const snapId = snap.id;

    if (data.cohortCommits.length > 0) {
      db.insert(schema.cohortMetrics)
        .values(
          data.cohortCommits.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            metricType: 'commits' as const,
            cohort: row.cohort,
            period: row.period,
            periodMonth: row.periodMonth,
            avgLinesAdded: row.avgLinesAdded,
            avgLinesDeleted: row.avgLinesDeleted,
            avgFilesChanged: row.avgFilesChanged,
            totalCount: row.totalCount,
            contributorCount: row.contributorCount,
          }))
        )
        .run();
    }

    if (data.cohortPrs.length > 0) {
      db.insert(schema.cohortMetrics)
        .values(
          data.cohortPrs.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            metricType: 'prs' as const,
            cohort: row.cohort,
            period: row.period,
            periodMonth: row.periodMonth,
            avgLinesAdded: row.avgLinesAdded,
            avgLinesDeleted: row.avgLinesDeleted,
            avgFilesChanged: row.avgFilesChanged,
            totalCount: row.totalCount,
            contributorCount: row.contributorCount,
          }))
        )
        .run();
    }

    if (data.rampUp.length > 0) {
      db.insert(schema.rampUp)
        .values(
          data.rampUp.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            weekIndex: row.weekIndex,
            avgLinesChanged: row.avgLinesChanged,
            avgFilesChanged: row.avgFilesChanged,
            contributionCount: row.contributionCount,
            contributorCount: row.contributorCount,
            joinPeriod: row.joinPeriod,
          }))
        )
        .run();
    }

    if (data.rolling !== null) {
      db.insert(schema.rollingComparisons)
        .values({
          snapshotId: snapId,
          orgId: orgId as number,
          dataJson: JSON.stringify(data.rolling),
        })
        .run();
    }

    if (data.contributors.length > 0) {
      db.insert(schema.contributors)
        .values(
          data.contributors.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            authorLogin: row.authorLogin,
            cohort: row.cohort,
            firstCommitAt: row.firstCommitAt ?? null,
            preJson: row.pre ? JSON.stringify(row.pre) : null,
            postJson: row.post ? JSON.stringify(row.post) : null,
          }))
        )
        .run();
    }

    if (data.prTurnaround.length > 0) {
      db.insert(schema.prTurnaround)
        .values(
          data.prTurnaround.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            periodMonth: row.periodMonth,
            avgHoursToMerge: row.avgHoursToMerge,
            medianHoursToMerge: row.medianHoursToMerge,
            prCount: row.prCount,
          }))
        )
        .run();
    }

    if (data.botRatio.length > 0) {
      db.insert(schema.botRatio)
        .values(
          data.botRatio.map((row) => ({
            snapshotId: snapId,
            orgId: orgId as number,
            periodMonth: row.periodMonth,
            botCommits: row.botCommits,
            humanCommits: row.humanCommits,
            totalCommits: row.totalCommits,
            botPercentage: row.botPercentage,
          }))
        )
        .run();
    }

    return snapId;
  });

  return {
    orgId: orgId as number,
    snapshotId,
    warnings,
    isDuplicate,
  };
}

// ─── Test data ────────────────────────────────────────────────────────────────

const sampleBundle = {
  metadata: {
    exportTimestamp: '2024-01-15T10:00:00Z',
    startDate: '2023-01-01T00:00:00Z',
    endDate: '2024-01-01T00:00:00Z',
    aiMarkerDate: '2023-06-01T00:00:00Z',
    tenureMode: 'global' as const,
    repoIds: [1, 2],
    repoNames: ['org/repo-a', 'org/repo-b'],
    cohortConfig: {
      thresholds: [
        { maxMonths: 3, key: 'new', label: 'New (0-3mo)', color: 'var(--chart-cohort-new)' },
        { maxMonths: 12, key: 'mid', label: 'Growing (3-12mo)', color: 'var(--chart-cohort-mid)' },
        { maxMonths: null, key: 'senior', label: 'Senior (1yr+)', color: 'var(--chart-cohort-senior)' },
      ] as [
        { maxMonths: number | null; key: string; label: string; color: string },
        { maxMonths: number | null; key: string; label: string; color: string },
        { maxMonths: number | null; key: string; label: string; color: string },
      ],
    },
    toolVersion: '1.0.0',
    rollingGranularity: 'month' as const,
  },
  cohortCommits: [
    {
      cohort: 'new',
      period: 'before' as const,
      periodMonth: '2023-01',
      avgLinesAdded: 100,
      avgLinesDeleted: 20,
      avgFilesChanged: 3,
      totalCount: 50,
      contributorCount: 5,
    },
  ],
  cohortPrs: [
    {
      cohort: 'mid',
      period: 'after' as const,
      periodMonth: '2023-07',
      avgLinesAdded: 200,
      avgLinesDeleted: 40,
      avgFilesChanged: 6,
      totalCount: 30,
      contributorCount: 3,
    },
  ],
  rampUp: [
    {
      weekIndex: 0,
      avgLinesChanged: 50,
      avgFilesChanged: 2,
      contributionCount: 10,
      contributorCount: 2,
      joinPeriod: 'before',
    },
  ],
  rolling: { months: [{ month: '2023-01', commits: 100 }] },
  contributors: [
    {
      authorLogin: 'alice',
      cohort: 'new',
      firstCommitAt: '2023-01-10T00:00:00Z',
      pre: {
        authorLogin: 'alice',
        cohort: 'new',
        totalCommits: 10,
        totalPrs: 3,
        avgLinesAdded: 50,
        avgLinesDeleted: 10,
        avgFilesChanged: 2,
        firstCommitAt: '2023-01-10T00:00:00Z',
      },
      post: null,
    },
    {
      authorLogin: 'bob',
      cohort: 'mid',
      firstCommitAt: '2022-06-01T00:00:00Z',
      pre: null,
      post: {
        authorLogin: 'bob',
        cohort: 'mid',
        totalCommits: 20,
        totalPrs: 8,
        avgLinesAdded: 80,
        avgLinesDeleted: 15,
        avgFilesChanged: 4,
        firstCommitAt: '2022-06-01T00:00:00Z',
      },
    },
  ],
  prTurnaround: [
    {
      periodMonth: '2023-01',
      avgHoursToMerge: 24,
      medianHoursToMerge: 18,
      prCount: 15,
    },
  ],
  botRatio: [
    {
      periodMonth: '2023-01',
      botCommits: 5,
      humanCommits: 95,
      totalCommits: 100,
      botPercentage: 5,
    },
  ],
  executiveSummary: {
    totalCommits: 500,
    activeContributors: 20,
    rampUpTrend: 'improving',
    aiAdoptionDelta: '+15%',
  },
  beforeAfter: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('importBundle', () => {
  let db: ReturnType<typeof createTestDb>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('importing a bundle creates org + snapshot + all data rows', () => {
    const result = importBundleWith(db, sampleBundle, null, 'file');

    expect(result.orgId).toBeGreaterThan(0);
    expect(result.snapshotId).toBeGreaterThan(0);
    expect(result.isDuplicate).toBe(false);

    // Verify org was created
    const org = getOrgWith(db, result.orgId);
    expect(org).toBeDefined();
    expect(org?.label).toContain('org/repo-a');

    // Verify snapshot was created
    const snaps = getSnapshotsForOrgWith(db, result.orgId);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].id).toBe(result.snapshotId);
    expect(snaps[0].contentHash).toBeTruthy();

    // Verify cohort_metrics rows (1 commit + 1 pr)
    const cohortRows = db.select().from(schema.cohortMetrics).all();
    expect(cohortRows).toHaveLength(2);

    // Verify ramp_up rows
    const rampRows = db.select().from(schema.rampUp).all();
    expect(rampRows).toHaveLength(1);

    // Verify rolling_comparisons row
    const rollingRows = db.select().from(schema.rollingComparisons).all();
    expect(rollingRows).toHaveLength(1);

    // Verify contributors rows
    const contRows = db.select().from(schema.contributors).all();
    expect(contRows).toHaveLength(2);

    // Verify pr_turnaround rows
    const ptRows = db.select().from(schema.prTurnaround).all();
    expect(ptRows).toHaveLength(1);

    // Verify bot_ratio rows
    const brRows = db.select().from(schema.botRatio).all();
    expect(brRows).toHaveLength(1);
  });

  it('importing the same bundle twice creates two snapshots with same contentHash, second returns isDuplicate=true', () => {
    const result1 = importBundleWith(db, sampleBundle, null, 'file');
    expect(result1.isDuplicate).toBe(false);

    // Import again to same org
    const result2 = importBundleWith(db, sampleBundle, result1.orgId, 'file');
    expect(result2.isDuplicate).toBe(true);

    // Two snapshots for the org
    const snaps = getSnapshotsForOrgWith(db, result1.orgId);
    expect(snaps).toHaveLength(2);

    // Both have the same contentHash
    expect(snaps[0].contentHash).toBe(snaps[1].contentHash);
  });

  it('deleteOrg cascades to delete all snapshot data', () => {
    const result = importBundleWith(db, sampleBundle, null, 'file');
    const orgId = result.orgId;

    // Verify data exists before delete
    expect(db.select().from(schema.cohortMetrics).all()).toHaveLength(2);

    deleteOrgWith(db, orgId);

    // Verify org and all data are gone
    expect(getOrgWith(db, orgId)).toBeUndefined();
    expect(getSnapshotsForOrgWith(db, orgId)).toHaveLength(0);
    expect(db.select().from(schema.cohortMetrics).all()).toHaveLength(0);
    expect(db.select().from(schema.contributors).all()).toHaveLength(0);
    expect(db.select().from(schema.rampUp).all()).toHaveLength(0);
    expect(db.select().from(schema.rollingComparisons).all()).toHaveLength(0);
    expect(db.select().from(schema.prTurnaround).all()).toHaveLength(0);
    expect(db.select().from(schema.botRatio).all()).toHaveLength(0);
  });

  it('deleteSnapshot removes only that snapshot data', () => {
    // Import twice to get two snapshots
    const result1 = importBundleWith(db, sampleBundle, null, 'file');
    const result2 = importBundleWith(db, sampleBundle, result1.orgId, 'file');

    expect(getSnapshotsForOrgWith(db, result1.orgId)).toHaveLength(2);

    // Delete only the first snapshot
    deleteSnapshotWith(db, result1.snapshotId);

    const remaining = getSnapshotsForOrgWith(db, result1.orgId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(result2.snapshotId);

    // Data from second snapshot should still exist
    const cohortRows = db
      .select()
      .from(schema.cohortMetrics)
      .where(eq(schema.cohortMetrics.snapshotId, result2.snapshotId))
      .all();
    expect(cohortRows).toHaveLength(2);
  });
});
