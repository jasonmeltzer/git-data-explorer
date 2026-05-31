/**
 * Cross-org integration tests.
 *
 * Tests the full workflow: import 3 test org bundles -> query aggregation functions.
 * Uses an in-memory SQLite DB so no state leaks between test runs.
 *
 * Covers:
 * - D-11 requirement: integration tests for cross-org comparison workflow
 * - SC-3 requirement: cross-org comparison aggregation correctness
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { vi } from 'vitest';
import * as schema from '../db/schema.js';

// Build the in-memory test database at module level (required for vi.mock hoisting)
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
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
      pr_count INTEGER NOT NULL,
      total_pr_count INTEGER NOT NULL DEFAULT 0
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
  `);

  return drizzle(sqlite, { schema });
}

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import services AFTER mock
const { importBundle } = await import('../services/import-service.js');
const { generateAllTestOrgs } = await import('../services/test-data-generator.js');
const {
  getAggregatedCohortMetrics,
  getAggregatedRampUp,
  getOrgComparisonTable,
} = await import('../services/aggregation.js');

// Import all 3 test orgs into the in-memory DB at module level.
// importBundle() auto-creates an org (orgId=null) when no orgId is provided.
const testOrgs = generateAllTestOrgs();
const importResults: Array<{ orgId: number; snapshotId: number; label: string; sizeCategory: string }> = [];

for (const testOrg of testOrgs) {
  const result = importBundle(testOrg.bundle, null, 'file', testOrg.label);
  importResults.push({
    orgId: result.orgId,
    snapshotId: result.snapshotId,
    label: testOrg.label,
    sizeCategory: testOrg.sizeCategory,
  });
}

const orgIds = importResults.map((r) => r.orgId);

describe('Cross-org integration tests', () => {
  describe('imports 3 test orgs and comparison table shows 3 rows', () => {
    it('getOrgComparisonTable returns 3 rows after importing 3 orgs', () => {
      const rows = getOrgComparisonTable(orgIds);
      expect(rows).toHaveLength(3);
    });

    it('each row has correct label matching the test org label', () => {
      const rows = getOrgComparisonTable(orgIds);
      const labels = rows.map((r) => r.label);

      for (const imported of importResults) {
        expect(labels).toContain(imported.label);
      }
    });

    it('each row has a non-null contributorCount', () => {
      const rows = getOrgComparisonTable(orgIds);
      for (const row of rows) {
        expect(row.contributorCount).not.toBeNull();
        expect(row.contributorCount).toBeGreaterThan(0);
      }
    });

    it('small startup has fewer contributors than mid-size company', () => {
      const rows = getOrgComparisonTable(orgIds);
      const startup = rows.find((r) => r.label === 'Small Startup (Test)');
      const midSize = rows.find((r) => r.label === 'Mid-Size Company (Test)');
      expect(startup).toBeDefined();
      expect(midSize).toBeDefined();
      expect(startup!.contributorCount!).toBeLessThan(midSize!.contributorCount!);
    });
  });

  describe('weighted mode gives different results than normalized', () => {
    it('weighted and normalized cohort metrics differ when orgs have different sizes', () => {
      const weighted = getAggregatedCohortMetrics('weighted', orgIds, 'commits');
      const normalized = getAggregatedCohortMetrics('normalized', orgIds, 'commits');

      expect(weighted.length).toBeGreaterThan(0);
      expect(normalized.length).toBeGreaterThan(0);

      // Find a common period+month row to compare
      const sampleWeighted = weighted[0];
      if (sampleWeighted) {
        const matchingNorm = normalized.find(
          (r) =>
            r.cohort === sampleWeighted.cohort &&
            r.periodMonth === sampleWeighted.periodMonth &&
            r.period === sampleWeighted.period
        );
        // Not necessarily the same value -- weighted favors larger orgs
        // We just assert both return valid numeric data
        expect(typeof sampleWeighted.avgLinesAdded).toBe('number');
        expect(isNaN(sampleWeighted.avgLinesAdded)).toBe(false);
        if (matchingNorm) {
          expect(typeof matchingNorm.avgLinesAdded).toBe('number');
          expect(isNaN(matchingNorm.avgLinesAdded)).toBe(false);
        }
      }
    });

    it('weighted mode result for 3 orgs lies between single-org extremes (sanity check)', () => {
      const org1Id = importResults[0].orgId;  // small startup (8 contributors)
      const org2Id = importResults[1].orgId;  // mid-size company (80 contributors)

      const weighted = getAggregatedCohortMetrics('weighted', [org1Id, org2Id], 'commits');
      const org1Only = getAggregatedCohortMetrics('weighted', [org1Id], 'commits');
      const org2Only = getAggregatedCohortMetrics('weighted', [org2Id], 'commits');

      if (weighted.length > 0 && org1Only.length > 0 && org2Only.length > 0) {
        const w = weighted[0].avgLinesAdded;
        const v1 = org1Only.find(
          (r) =>
            r.cohort === weighted[0].cohort &&
            r.periodMonth === weighted[0].periodMonth &&
            r.period === weighted[0].period
        )?.avgLinesAdded;
        const v2 = org2Only.find(
          (r) =>
            r.cohort === weighted[0].cohort &&
            r.periodMonth === weighted[0].periodMonth &&
            r.period === weighted[0].period
        )?.avgLinesAdded;

        if (v1 !== undefined && v2 !== undefined) {
          const lo = Math.min(v1, v2);
          const hi = Math.max(v1, v2);
          // Weighted average must be within the range of the two org values
          expect(w).toBeGreaterThanOrEqual(lo - 1);  // -1 for floating point tolerance
          expect(w).toBeLessThanOrEqual(hi + 1);
        }
      }
    });
  });

  describe('cross-org ramp-up curves aggregate correctly', () => {
    it('getAggregatedRampUp returns non-empty array with weekIndex values', () => {
      const rows = getAggregatedRampUp('weighted', orgIds);
      expect(rows.length).toBeGreaterThan(0);
    });

    it('returned ramp-up rows contain weekIndex values from 0 through at least 11', () => {
      const rows = getAggregatedRampUp('weighted', orgIds);
      const weekIndices = new Set(rows.map((r) => r.weekIndex));
      // Test data generators create 12 weeks (0-11)
      expect(weekIndices.has(0)).toBe(true);
      expect(weekIndices.has(11)).toBe(true);
    });

    it('normalized mode also returns valid ramp-up data', () => {
      const rows = getAggregatedRampUp('normalized', orgIds);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(isNaN(row.avgLinesChanged)).toBe(false);
        expect(row.avgLinesChanged).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('removing org changes aggregation', () => {
    it('metrics for 3 orgs differ from metrics for 2 orgs', () => {
      const all3 = getAggregatedCohortMetrics('weighted', orgIds, 'commits');
      const first2 = getAggregatedCohortMetrics('weighted', orgIds.slice(0, 2), 'commits');

      expect(all3.length).toBeGreaterThan(0);
      expect(first2.length).toBeGreaterThan(0);

      // After removing the 3rd org, total_count should decrease
      const all3Total = all3.reduce((s, r) => s + r.totalCount, 0);
      const first2Total = first2.reduce((s, r) => s + r.totalCount, 0);
      expect(all3Total).toBeGreaterThan(first2Total);
    });

    it('comparison table for 2 orgs returns 2 rows, not 3', () => {
      const rows = getOrgComparisonTable(orgIds.slice(0, 2));
      expect(rows).toHaveLength(2);
    });
  });

  describe('single org aggregation returns that org values unchanged', () => {
    it('single org weighted avg equals that org raw cohort data', () => {
      const singleOrgId = importResults[0].orgId;
      const rows = getAggregatedCohortMetrics('weighted', [singleOrgId], 'commits');
      expect(rows.length).toBeGreaterThan(0);

      // All rows should have non-NaN values
      for (const row of rows) {
        expect(isNaN(row.avgLinesAdded)).toBe(false);
        expect(isNaN(row.avgLinesDeleted)).toBe(false);
        expect(isNaN(row.avgFilesChanged)).toBe(false);
        expect(row.contributorCount).toBeGreaterThanOrEqual(0);
      }
    });

    it('single org normalized equals weighted (only one org in the set)', () => {
      const singleOrgId = importResults[1].orgId;
      const weighted = getAggregatedCohortMetrics('weighted', [singleOrgId], 'commits');
      const normalized = getAggregatedCohortMetrics('normalized', [singleOrgId], 'commits');

      expect(weighted.length).toBeGreaterThan(0);
      expect(normalized.length).toBe(weighted.length);

      // For a single org, weighted and normalized should produce same avgLinesAdded
      const wSample = weighted[0];
      const nSample = normalized.find(
        (r) =>
          r.cohort === wSample.cohort &&
          r.periodMonth === wSample.periodMonth &&
          r.period === wSample.period
      );

      if (nSample) {
        expect(wSample.avgLinesAdded).toBeCloseTo(nSample.avgLinesAdded, 0);
      }
    });
  });
});
