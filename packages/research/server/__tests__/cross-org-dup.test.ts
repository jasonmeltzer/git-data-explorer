/**
 * Cross-org duplicate detection tests.
 *
 * Tests that importing a bundle into a different org triggers cross-org
 * duplicate warnings (exact hash match and fuzzy match) while keeping
 * same-org duplicate behavior unchanged.
 *
 * Uses an in-memory SQLite DB with the same schema as production.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { vi } from 'vitest';
import * as schema from '../db/schema.js';
import type { ExportBundle } from '@shared/export-types.js';

const CREATE_TABLES_SQL = `
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
    avg_lines_changed REAL NOT NULL DEFAULT 0,
    avg_files_changed REAL NOT NULL DEFAULT 0,
    contribution_count INTEGER NOT NULL DEFAULT 0,
    contributor_count INTEGER NOT NULL DEFAULT 0,
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

// Fresh DB for each test suite run
const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
sqlite.exec(CREATE_TABLES_SQL);
const testDb = drizzle(sqlite, { schema });

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import services AFTER mock
const { importBundle } = await import('../services/import-service.js');
const { createOrg } = await import('../services/org-service.js');

/** Minimal valid ExportBundle for testing */
function makeBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    metadata: {
      exportTimestamp: '2026-04-10T12:00:00Z',
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2025-06-30T00:00:00Z',
      aiMarkerDate: '2025-03-15',
      tenureMode: 'global',
      repoIds: [1, 2],
      repoNames: ['acme/repo-a', 'acme/repo-b'],
      cohortConfig: {
        thresholds: [
          { maxMonths: 3, key: 'new', label: '0-3 mo', color: '#4a90d9' },
          { maxMonths: 12, key: 'mid', label: '3-12 mo', color: '#82b366' },
          { maxMonths: null, key: 'senior', label: '1 yr+', color: '#d9a441' },
        ],
      },
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: 'acme',
    },
    cohortCommits: [
      { cohort: 'new', period: 'before', periodMonth: '2025-02', avgLinesAdded: 40, avgLinesDeleted: 10, avgFilesChanged: 3, totalCount: 15, contributorCount: 3 },
    ],
    cohortPrs: [],
    rampUp: [],
    rolling: null,
    contributors: [
      {
        authorLogin: 'alice',
        cohort: 'new',
        firstCommitAt: '2025-01-15T10:00:00Z',
        pre: { authorLogin: 'alice', cohort: 'new', totalCommits: 10, totalPrs: 3, avgLinesAdded: 30, avgLinesDeleted: 10, avgFilesChanged: 2, firstCommitAt: '2025-01-15T10:00:00Z' },
        post: null,
      },
    ],
    prTurnaround: [],
    botRatio: [],
    executiveSummary: null,
    beforeAfter: null,
    ...overrides,
  };
}

/** Create a different bundle with overlapping repos/dates */
function makeFuzzyBundle(): ExportBundle {
  return makeBundle({
    metadata: {
      exportTimestamp: '2026-04-11T12:00:00Z',
      startDate: '2025-03-01T00:00:00Z',
      endDate: '2025-09-30T00:00:00Z',
      aiMarkerDate: '2025-06-15',
      tenureMode: 'global',
      repoIds: [1],
      repoNames: ['acme/repo-a'],
      cohortConfig: {
        thresholds: [
          { maxMonths: 3, key: 'new', label: '0-3 mo', color: '#4a90d9' },
          { maxMonths: 12, key: 'mid', label: '3-12 mo', color: '#82b366' },
          { maxMonths: null, key: 'senior', label: '1 yr+', color: '#d9a441' },
        ],
      },
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: 'acme',
    },
    cohortCommits: [
      { cohort: 'mid', period: 'after', periodMonth: '2025-07', avgLinesAdded: 60, avgLinesDeleted: 20, avgFilesChanged: 4, totalCount: 20, contributorCount: 5 },
    ],
    contributors: [
      {
        authorLogin: 'bob',
        cohort: 'mid',
        firstCommitAt: '2025-05-01T10:00:00Z',
        pre: null,
        post: { authorLogin: 'bob', cohort: 'mid', totalCommits: 20, totalPrs: 5, avgLinesAdded: 60, avgLinesDeleted: 20, avgFilesChanged: 4, firstCommitAt: '2025-05-01T10:00:00Z' },
      },
    ],
  });
}

/** Create a completely unique bundle with no overlap */
function makeUniqueBundle(): ExportBundle {
  return makeBundle({
    metadata: {
      exportTimestamp: '2026-04-12T12:00:00Z',
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-06-30T00:00:00Z',
      aiMarkerDate: null,
      tenureMode: 'global',
      repoIds: [99, 100],
      repoNames: ['zeta/widget', 'zeta/gadget'],
      cohortConfig: {
        thresholds: [
          { maxMonths: 3, key: 'new', label: '0-3 mo', color: '#4a90d9' },
          { maxMonths: 12, key: 'mid', label: '3-12 mo', color: '#82b366' },
          { maxMonths: null, key: 'senior', label: '1 yr+', color: '#d9a441' },
        ],
      },
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
      orgName: 'zeta',
    },
    cohortCommits: [
      { cohort: 'senior', period: 'all', periodMonth: '2024-03', avgLinesAdded: 100, avgLinesDeleted: 50, avgFilesChanged: 8, totalCount: 30, contributorCount: 6 },
    ],
    contributors: [
      {
        authorLogin: 'charlie',
        cohort: 'senior',
        firstCommitAt: '2023-01-01T10:00:00Z',
        pre: { authorLogin: 'charlie', cohort: 'senior', totalCommits: 100, totalPrs: 30, avgLinesAdded: 100, avgLinesDeleted: 50, avgFilesChanged: 8, firstCommitAt: '2023-01-01T10:00:00Z' },
        post: null,
      },
    ],
  });
}

describe('Cross-org duplicate detection', () => {
  // Clean all data before each test
  beforeEach(() => {
    sqlite.exec('DELETE FROM bot_ratio');
    sqlite.exec('DELETE FROM pr_turnaround');
    sqlite.exec('DELETE FROM contributors');
    sqlite.exec('DELETE FROM rolling_comparisons');
    sqlite.exec('DELETE FROM ramp_up');
    sqlite.exec('DELETE FROM cohort_metrics');
    sqlite.exec('DELETE FROM snapshots');
    sqlite.exec('DELETE FROM orgs');
  });

  it('Test 1: exact cross-org match returns crossOrgDuplicate', () => {
    const bundle = makeBundle();
    const orgA = createOrg('Org A', 'file', 'small');
    const orgB = createOrg('Org B', 'file', 'small');

    // Import to Org A first
    const resultA = importBundle(bundle, orgA, 'file');
    expect(resultA.crossOrgDuplicate).toBeUndefined();

    // Import same bundle to Org B
    const resultB = importBundle(bundle, orgB, 'file');
    expect(resultB.crossOrgDuplicate).toBeDefined();
    expect(resultB.crossOrgDuplicate!.otherOrgName).toBe('Org A');
    expect(resultB.crossOrgDuplicate!.importedAt).toBeDefined();
    // Import still succeeds
    expect(resultB.snapshotId).toBeGreaterThan(0);
  });

  it('Test 2: fuzzy match returns fuzzyMatch when repos and dates overlap', () => {
    const bundleA = makeBundle();
    const bundleB = makeFuzzyBundle();
    const orgA = createOrg('Org A', 'file', 'small');
    const orgB = createOrg('Org B', 'file', 'small');

    // Import bundle A to Org A
    importBundle(bundleA, orgA, 'file');

    // Import fuzzy-matching bundle B to Org B (different content hash, but overlapping repos+dates)
    const resultB = importBundle(bundleB, orgB, 'file');
    expect(resultB.fuzzyMatch).toBeDefined();
    expect(resultB.fuzzyMatch!.otherOrgName).toBe('Org A');
    expect(resultB.fuzzyMatch!.overlapReason).toContain('repos');
    expect(resultB.fuzzyMatch!.overlapReason).toContain('date');
    expect(resultB.fuzzyMatch!.importedAt).toBeDefined();
    // Import still succeeds
    expect(resultB.snapshotId).toBeGreaterThan(0);
  });

  it('Test 3: same-org duplicate unchanged, no crossOrgDuplicate', () => {
    const bundle = makeBundle();
    const orgA = createOrg('Org A', 'file', 'small');

    // Import same bundle twice to same org
    const result1 = importBundle(bundle, orgA, 'file');
    expect(result1.isDuplicate).toBe(false);

    const result2 = importBundle(bundle, orgA, 'file');
    expect(result2.isDuplicate).toBe(true);
    // Same-org dup should NOT trigger crossOrgDuplicate
    expect(result2.crossOrgDuplicate).toBeUndefined();
  });

  it('Test 4: both exact and fuzzy signals can appear on same import', () => {
    // Import the exact same bundle to a different org — both exact hash
    // and fuzzy match (overlapping repos + date range) should fire.
    const bundle = makeBundle();
    const orgA = createOrg('Org A', 'file', 'small');
    const orgB = createOrg('Org B', 'file', 'small');

    importBundle(bundle, orgA, 'file');
    const resultB = importBundle(bundle, orgB, 'file');

    expect(resultB.crossOrgDuplicate).toBeDefined();
    expect(resultB.fuzzyMatch).toBeDefined();
    // Import still succeeds
    expect(resultB.snapshotId).toBeGreaterThan(0);
  });

  it('Test 5: bundles with missing vs explicit empty optional arrays hash identically (WR-02)', () => {
    // Bundle A has cohortPrs explicitly set to []
    const bundleA = makeBundle({ cohortPrs: [] });

    // Bundle B omits cohortPrs entirely — Zod .default([]) will normalize it to []
    const { cohortPrs: _removed, ...bundleBRaw } = makeBundle() as Record<string, unknown>;
    // Manually delete the key so it's truly absent
    const bundleB = { ...bundleBRaw };
    delete (bundleB as Record<string, unknown>)['cohortPrs'];

    const orgA = createOrg('Org A', 'file', 'small');

    // Import bundle A first
    const resultA = importBundle(bundleA, orgA, 'file');
    expect(resultA.isDuplicate).toBe(false);

    // Import bundle B (missing cohortPrs) to same org — should be detected as duplicate
    // because after Zod normalization, both bundles have identical data
    const resultB = importBundle(bundleB, orgA, 'file');
    expect(resultB.isDuplicate).toBe(true);
  });

  it('Test 6: unique bundle to new org has no cross-org signals', () => {
    const uniqueBundle = makeUniqueBundle();
    const orgC = createOrg('Org C', 'file', 'small');

    const result = importBundle(uniqueBundle, orgC, 'file');
    expect(result.crossOrgDuplicate).toBeUndefined();
    expect(result.fuzzyMatch).toBeUndefined();
    expect(result.snapshotId).toBeGreaterThan(0);
  });
});
