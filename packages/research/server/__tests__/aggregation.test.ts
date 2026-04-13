/**
 * Cross-org aggregation tests.
 * Tests mathematical correctness for weighted and normalized aggregation modes.
 * Uses in-memory SQLite so no file system state is shared between test runs.
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

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import services AFTER mock
const { getAggregatedCohortMetrics, getAggregatedRampUp, getOrgComparisonTable, getLatestSnapshotIds } =
  await import('../services/aggregation.js');

// Seed data setup (org IDs 1-4 used across tests)
// Org 1: avgLinesAdded=100, contributorCount=10
// Org 2: avgLinesAdded=200, contributorCount=5
testDb.insert(schema.orgs).values([
  { id: 1, label: 'Org A', sizeCategory: 'small', importSource: 'file', createdAt: Date.now() },
  { id: 2, label: 'Org B', sizeCategory: 'medium', importSource: 'file', createdAt: Date.now() },
]).run();

testDb.insert(schema.snapshots).values([
  { id: 1, orgId: 1, importTimestamp: Date.now(), metadataJson: '{}', contributorCount: 10, repoCount: 2 },
  { id: 2, orgId: 2, importTimestamp: Date.now(), metadataJson: '{}', contributorCount: 5, repoCount: 3 },
]).run();

testDb.insert(schema.cohortMetrics).values([
  // Org A: avgLinesAdded=100, contributorCount=10
  { snapshotId: 1, orgId: 1, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-01', avgLinesAdded: 100, avgLinesDeleted: 50, avgFilesChanged: 3, totalCount: 100, contributorCount: 10 },
  { snapshotId: 1, orgId: 1, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-02', avgLinesAdded: 100, avgLinesDeleted: 50, avgFilesChanged: 3, totalCount: 100, contributorCount: 10 },
  // Org B: avgLinesAdded=200, contributorCount=5
  { snapshotId: 2, orgId: 2, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-01', avgLinesAdded: 200, avgLinesDeleted: 100, avgFilesChanged: 6, totalCount: 50, contributorCount: 5 },
  { snapshotId: 2, orgId: 2, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-02', avgLinesAdded: 200, avgLinesDeleted: 100, avgFilesChanged: 6, totalCount: 50, contributorCount: 5 },
]).run();

testDb.insert(schema.rampUp).values([
  { snapshotId: 1, orgId: 1, weekIndex: 0, avgLinesChanged: 50, avgFilesChanged: 2, contributionCount: 100, contributorCount: 10, joinPeriod: '2025-Q1' },
  { snapshotId: 1, orgId: 1, weekIndex: 1, avgLinesChanged: 80, avgFilesChanged: 3, contributionCount: 90, contributorCount: 10, joinPeriod: '2025-Q1' },
  { snapshotId: 2, orgId: 2, weekIndex: 0, avgLinesChanged: 100, avgFilesChanged: 4, contributionCount: 50, contributorCount: 5, joinPeriod: '2025-Q1' },
  { snapshotId: 2, orgId: 2, weekIndex: 1, avgLinesChanged: 150, avgFilesChanged: 5, contributionCount: 40, contributorCount: 5, joinPeriod: '2025-Q1' },
]).run();

describe('Cross-org aggregation service', () => {
  describe('getLatestSnapshotIds', () => {
    it('returns the latest snapshot id per org', () => {
      const snapshotMap = getLatestSnapshotIds([1, 2]);
      expect(snapshotMap.get(1)).toBe(1);
      expect(snapshotMap.get(2)).toBe(2);
    });
  });

  describe('getAggregatedCohortMetrics - weighted mode', () => {
    it('computes weighted avg: (100*10 + 200*5) / (10+5) = 133.33', () => {
      const rows = getAggregatedCohortMetrics('weighted', [1, 2], 'commits');
      expect(rows.length).toBeGreaterThan(0);
      const jan = rows.find(r => r.periodMonth === '2025-01');
      expect(jan).toBeDefined();
      // Weighted avg = (100*10 + 200*5) / (10+5) = (1000+1000) / 15 = 133.33
      expect(jan!.avgLinesAdded).toBeCloseTo(133.33, 1);
    });

    it('handles zero contributors gracefully (returns null/zero not NaN)', () => {
      // Insert a snapshot with 0-contributor rows
      testDb.insert(schema.snapshots).values(
        { id: 99, orgId: 1, importTimestamp: Date.now() - 1000, metadataJson: '{}' }
      ).run();
      testDb.insert(schema.cohortMetrics).values(
        { snapshotId: 99, orgId: 1, metricType: 'commits', cohort: 'senior', period: 'all', periodMonth: '2025-03', avgLinesAdded: 0, avgLinesDeleted: 0, avgFilesChanged: 0, totalCount: 0, contributorCount: 0 }
      ).run();

      // After insert, get metrics — the 0-contributor row should not produce NaN
      const rows = getAggregatedCohortMetrics('weighted', [1], 'commits');
      for (const row of rows) {
        expect(isNaN(row.avgLinesAdded)).toBe(false);
      }
    });

    it('single org returns unchanged values', () => {
      const rows = getAggregatedCohortMetrics('weighted', [1], 'commits');
      const jan = rows.find(r => r.periodMonth === '2025-01');
      expect(jan).toBeDefined();
      // Single org: weighted avg should equal org A's value (100)
      expect(jan!.avgLinesAdded).toBeCloseTo(100, 1);
    });
  });

  describe('getAggregatedCohortMetrics - normalized mode', () => {
    it('computes normalized avg: (100+200)/2 = 150 (each org counts equally)', () => {
      const rows = getAggregatedCohortMetrics('normalized', [1, 2], 'commits');
      expect(rows.length).toBeGreaterThan(0);
      const jan = rows.find(r => r.periodMonth === '2025-01');
      expect(jan).toBeDefined();
      // Normalized avg: each org counts equally = (100+200)/2 = 150
      expect(jan!.avgLinesAdded).toBeCloseTo(150, 1);
    });

    it('size normalization: 10-person vs 100-person org - weighted favors large, normalized is simple avg', () => {
      // Large org: 100 contributors, low commit size = 50
      testDb.insert(schema.orgs).values(
        { id: 3, label: 'Large Org', sizeCategory: 'large', importSource: 'file', createdAt: Date.now() }
      ).run();
      testDb.insert(schema.snapshots).values(
        { id: 3, orgId: 3, importTimestamp: Date.now(), metadataJson: '{}', contributorCount: 100 }
      ).run();
      testDb.insert(schema.cohortMetrics).values(
        { snapshotId: 3, orgId: 3, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-01', avgLinesAdded: 50, avgLinesDeleted: 25, avgFilesChanged: 2, totalCount: 5000, contributorCount: 100 }
      ).run();

      // Small org: 10 contributors, high commit size = 500
      testDb.insert(schema.orgs).values(
        { id: 4, label: 'Small Org', sizeCategory: 'small', importSource: 'file', createdAt: Date.now() }
      ).run();
      testDb.insert(schema.snapshots).values(
        { id: 4, orgId: 4, importTimestamp: Date.now(), metadataJson: '{}', contributorCount: 10 }
      ).run();
      testDb.insert(schema.cohortMetrics).values(
        { snapshotId: 4, orgId: 4, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-01', avgLinesAdded: 500, avgLinesDeleted: 250, avgFilesChanged: 10, totalCount: 500, contributorCount: 10 }
      ).run();

      // Weighted: (50*100 + 500*10) / (100+10) = (5000+5000)/110 = 90.9
      const weightedRows = getAggregatedCohortMetrics('weighted', [3, 4], 'commits');
      const weightedJan = weightedRows.find(r => r.periodMonth === '2025-01');
      expect(weightedJan).toBeDefined();
      expect(weightedJan!.avgLinesAdded).toBeCloseTo(90.9, 1);

      // Normalized: simple average = (50+500)/2 = 275
      const normalizedRows = getAggregatedCohortMetrics('normalized', [3, 4], 'commits');
      const normalizedJan = normalizedRows.find(r => r.periodMonth === '2025-01');
      expect(normalizedJan).toBeDefined();
      expect(normalizedJan!.avgLinesAdded).toBeCloseTo(275, 1);
    });
  });

  describe('getAggregatedRampUp', () => {
    it('aggregates weekly ramp-up curves across orgs (weighted)', () => {
      const rows = getAggregatedRampUp('weighted', [1, 2]);
      expect(rows.length).toBeGreaterThan(0);

      // week 0: Org A=50 (10 contributors), Org B=100 (5 contributors)
      // Weighted: (50*10 + 100*5) / (10+5) = (500+500)/15 = 66.67
      const week0 = rows.find(r => r.weekIndex === 0 && r.joinPeriod === '2025-Q1');
      expect(week0).toBeDefined();
      expect(week0!.avgLinesChanged).toBeCloseTo(66.67, 1);
    });

    it('aggregates weekly ramp-up curves across orgs (normalized)', () => {
      const rows = getAggregatedRampUp('normalized', [1, 2]);
      const week0 = rows.find(r => r.weekIndex === 0 && r.joinPeriod === '2025-Q1');
      expect(week0).toBeDefined();
      // Normalized: (50+100)/2 = 75
      expect(week0!.avgLinesChanged).toBeCloseTo(75, 1);
    });
  });

  describe('getOrgComparisonTable', () => {
    it('returns one row per org with correct metrics', () => {
      const rows = getOrgComparisonTable([1, 2]);
      expect(rows).toHaveLength(2);

      const orgA = rows.find(r => r.id === 1);
      const orgB = rows.find(r => r.id === 2);

      expect(orgA).toBeDefined();
      expect(orgB).toBeDefined();
      expect(orgA!.label).toBe('Org A');
      expect(orgB!.label).toBe('Org B');
      expect(orgA!.contributorCount).toBe(10);
      expect(orgB!.contributorCount).toBe(5);
    });
  });
});
