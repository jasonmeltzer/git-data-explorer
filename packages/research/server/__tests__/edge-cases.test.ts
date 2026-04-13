/**
 * Edge case tests (D-11-4).
 *
 * Validates that the import pipeline and aggregation engine handle:
 * - All-null optional sections
 * - Empty arrays for all data sections
 * - Mismatched date ranges (startDate > endDate)
 * - Duplicate bundle detection (same content hash)
 * - Aggregation with 0 contributor_count
 * - Aggregation across orgs with mismatched time ranges
 * - Old toolVersion bundles (backward compatibility)
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { vi } from 'vitest';
import * as schema from '../db/schema.js';
import type { ExportBundle } from '@shared/export-types.js';
import { DEFAULT_COHORT_CONFIG } from '@shared/cohort-config.js';

// Build the in-memory test database at module level (required for vi.mock hoisting)
function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

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

const testDb = createTestDb();

vi.mock('../db/client.js', () => ({
  db: testDb,
  sqlite: null,
}));

// Import services AFTER mock
const { importBundle } = await import('../services/import-service.js');
const { validateBundle } = await import('../services/validation.js');
const { getAggregatedCohortMetrics } = await import('../services/aggregation.js');

// ─── Minimal valid metadata helper ───────────────────────────────────────────

function makeMinimalBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  const base: ExportBundle = {
    metadata: {
      exportTimestamp: '2025-01-15T10:00:00Z',
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2025-01-01T00:00:00Z',
      aiMarkerDate: null,
      tenureMode: 'global',
      repoIds: [1],
      repoNames: ['org/repo-1'],
      cohortConfig: DEFAULT_COHORT_CONFIG,
      toolVersion: '1.0.0',
      rollingGranularity: 'month',
    },
    cohortCommits: [{
      cohort: 'new',
      period: 'all',
      periodMonth: '2024-06',
      avgLinesAdded: 100,
      avgLinesDeleted: 30,
      avgFilesChanged: 3,
      totalCount: 10,
      contributorCount: 2,
    }],
    cohortPrs: [],
    rampUp: [],
    rolling: null,
    contributors: [],
    prTurnaround: [],
    botRatio: [],
    executiveSummary: null,
    beforeAfter: null,
  };
  return { ...base, ...overrides };
}

// ─── Edge case tests ──────────────────────────────────────────────────────────

describe('Edge case tests (D-11-4)', () => {
  describe('accepts bundle with all null optional sections', () => {
    it('validateBundle returns valid=true with warnings for null sections', () => {
      const bundle = makeMinimalBundle({
        rolling: null,
        executiveSummary: null,
        beforeAfter: null,
      });
      const result = validateBundle(bundle);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('rolling section is null');
      expect(result.warnings).toContain('executiveSummary section is null');
      expect(result.warnings).toContain('beforeAfter section is null');
    });

    it('importBundle succeeds even with all optional sections null', () => {
      const bundle = makeMinimalBundle({
        rolling: null,
        executiveSummary: null,
        beforeAfter: null,
      });
      let result: Awaited<ReturnType<typeof importBundle>>;
      expect(() => {
        result = importBundle(bundle, null, 'file', 'Null Sections Org');
      }).not.toThrow();
      // If we get here, it returned successfully
      expect(result!.orgId).toBeGreaterThan(0);
      expect(result!.snapshotId).toBeGreaterThan(0);
    });
  });

  describe('accepts bundle with empty arrays for all sections', () => {
    it('validateBundle warns about empty cohortCommits and cohortPrs and contributors', () => {
      const bundle = makeMinimalBundle({
        cohortCommits: [],
        cohortPrs: [],
        rampUp: [],
        contributors: [],
      });
      const result = validateBundle(bundle);
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('cohortCommits is empty');
      expect(result.warnings).toContain('cohortPrs is empty');
      expect(result.warnings).toContain('contributors is empty');
    });

    it('importBundle with all empty arrays creates snapshot with 0 child rows', () => {
      const bundle = makeMinimalBundle({
        cohortCommits: [],
        cohortPrs: [],
        rampUp: [],
        contributors: [],
        prTurnaround: [],
        botRatio: [],
      });
      let result: Awaited<ReturnType<typeof importBundle>>;
      expect(() => {
        result = importBundle(bundle, null, 'file', 'Empty Arrays Org');
      }).not.toThrow();
      expect(result!.orgId).toBeGreaterThan(0);
      expect(result!.snapshotId).toBeGreaterThan(0);

      // Verify 0 cohort_metrics rows for this org (empty cohortCommits and cohortPrs)
      const metrics = getAggregatedCohortMetrics('weighted', [result!.orgId], 'commits');
      expect(metrics).toHaveLength(0);
    });
  });

  describe('accepts bundle with mismatched date ranges', () => {
    it('validation passes even when endDate is before startDate', () => {
      const bundle = makeMinimalBundle({
        metadata: {
          exportTimestamp: '2025-01-15T10:00:00Z',
          startDate: '2025-01-01T00:00:00Z',  // startDate AFTER endDate
          endDate: '2024-01-01T00:00:00Z',    // endDate BEFORE startDate
          aiMarkerDate: null,
          tenureMode: 'global',
          repoIds: [1],
          repoNames: ['org/repo-1'],
          cohortConfig: DEFAULT_COHORT_CONFIG,
          toolVersion: '1.0.0',
          rollingGranularity: 'month',
        },
      });
      const result = validateBundle(bundle);
      // Schema validates shape, not date range business logic
      expect(result.valid).toBe(true);
    });

    it('importBundle succeeds with mismatched date range bundle', () => {
      const bundle = makeMinimalBundle({
        metadata: {
          exportTimestamp: '2025-01-15T10:00:00Z',
          startDate: '2025-06-01T00:00:00Z',
          endDate: '2024-01-01T00:00:00Z',
          aiMarkerDate: null,
          tenureMode: 'global',
          repoIds: [1],
          repoNames: ['org/repo-x'],
          cohortConfig: DEFAULT_COHORT_CONFIG,
          toolVersion: '1.0.0',
          rollingGranularity: 'month',
        },
      });
      expect(() => {
        importBundle(bundle, null, 'file', 'Mismatched Date Range Org');
      }).not.toThrow();
    });
  });

  describe('warns on duplicate import by content hash', () => {
    it('second import of identical bundle returns isDuplicate=true', () => {
      const bundle = makeMinimalBundle({
        metadata: {
          exportTimestamp: '2025-03-01T10:00:00Z',  // unique timestamp to avoid collision with other tests
          startDate: '2024-03-01T00:00:00Z',
          endDate: '2025-03-01T00:00:00Z',
          aiMarkerDate: null,
          tenureMode: 'global',
          repoIds: [99],
          repoNames: ['org/dedup-test-repo'],
          cohortConfig: DEFAULT_COHORT_CONFIG,
          toolVersion: '1.0.0',
          rollingGranularity: 'month',
        },
      });

      // First import — creates a new org
      const first = importBundle(bundle, null, 'file', 'Dedup Test Org');
      expect(first.isDuplicate).toBe(false);

      // Second import to the SAME org — same content, same orgId
      const second = importBundle(bundle, first.orgId, 'file');
      expect(second.isDuplicate).toBe(true);
      expect(second.warnings).toContain(
        'Duplicate bundle detected (same content hash) — importing as new snapshot anyway'
      );
    });
  });

  describe('aggregation with 0 contributor_count returns null-free results', () => {
    it('aggregation handles rows with contributor_count=0 without producing NaN', () => {
      // Insert org and snapshot with 0-contributor cohort metrics
      testDb.insert(schema.orgs).values({
        id: 9001,
        label: 'Zero Contributor Org',
        importSource: 'file',
        createdAt: Date.now(),
      }).run();
      testDb.insert(schema.snapshots).values({
        id: 9001,
        orgId: 9001,
        importTimestamp: Date.now(),
        metadataJson: '{}',
        contributorCount: 0,
      }).run();
      testDb.insert(schema.cohortMetrics).values([
        {
          snapshotId: 9001,
          orgId: 9001,
          metricType: 'commits',
          cohort: 'new',
          period: 'all',
          periodMonth: '2024-09',
          avgLinesAdded: 0,
          avgLinesDeleted: 0,
          avgFilesChanged: 0,
          totalCount: 0,
          contributorCount: 0,
        },
      ]).run();

      const rows = getAggregatedCohortMetrics('weighted', [9001], 'commits');
      // COALESCE in SQL means 0-contributor rows produce 0, not NaN
      for (const row of rows) {
        expect(isNaN(row.avgLinesAdded)).toBe(false);
        expect(isNaN(row.avgLinesDeleted)).toBe(false);
        expect(isNaN(row.avgFilesChanged)).toBe(false);
      }
    });
  });

  describe('aggregation handles mismatched time ranges across orgs', () => {
    it('orgs with different time ranges are combined with data for each range', () => {
      // Org A: 2024-01 to 2024-06
      // Org B: 2025-01 to 2025-06
      testDb.insert(schema.orgs).values([
        { id: 9002, label: 'Org Early 2024', importSource: 'file', createdAt: Date.now() },
        { id: 9003, label: 'Org Early 2025', importSource: 'file', createdAt: Date.now() },
      ]).run();
      testDb.insert(schema.snapshots).values([
        { id: 9002, orgId: 9002, importTimestamp: Date.now(), metadataJson: '{}', contributorCount: 10 },
        { id: 9003, orgId: 9003, importTimestamp: Date.now(), metadataJson: '{}', contributorCount: 15 },
      ]).run();

      testDb.insert(schema.cohortMetrics).values([
        // Org A covers 2024 months only
        { snapshotId: 9002, orgId: 9002, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2024-01', avgLinesAdded: 100, avgLinesDeleted: 30, avgFilesChanged: 3, totalCount: 20, contributorCount: 10 },
        { snapshotId: 9002, orgId: 9002, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2024-06', avgLinesAdded: 120, avgLinesDeleted: 35, avgFilesChanged: 4, totalCount: 25, contributorCount: 10 },
        // Org B covers 2025 months only
        { snapshotId: 9003, orgId: 9003, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-01', avgLinesAdded: 150, avgLinesDeleted: 50, avgFilesChanged: 5, totalCount: 30, contributorCount: 15 },
        { snapshotId: 9003, orgId: 9003, metricType: 'commits', cohort: 'new', period: 'all', periodMonth: '2025-06', avgLinesAdded: 160, avgLinesDeleted: 55, avgFilesChanged: 6, totalCount: 35, contributorCount: 15 },
      ]).run();

      const rows = getAggregatedCohortMetrics('weighted', [9002, 9003], 'commits');
      // Should return rows for both time ranges (4 total rows — 2 per org)
      expect(rows.length).toBe(4);

      const jan2024 = rows.find((r) => r.periodMonth === '2024-01');
      const jan2025 = rows.find((r) => r.periodMonth === '2025-01');
      expect(jan2024).toBeDefined();
      expect(jan2025).toBeDefined();
      // Each period has only one org — weighted avg = that org's values
      expect(jan2024!.avgLinesAdded).toBeCloseTo(100, 0);
      expect(jan2025!.avgLinesAdded).toBeCloseTo(150, 0);
    });
  });

  describe('old format version bundle still importable', () => {
    it('bundle with toolVersion="0.1.0" passes validation (no version check)', () => {
      const bundle = makeMinimalBundle({
        metadata: {
          exportTimestamp: '2024-06-01T10:00:00Z',
          startDate: '2023-06-01T00:00:00Z',
          endDate: '2024-06-01T00:00:00Z',
          aiMarkerDate: null,
          tenureMode: 'global',
          repoIds: [1],
          repoNames: ['org/legacy-repo'],
          cohortConfig: DEFAULT_COHORT_CONFIG,
          toolVersion: '0.1.0',  // old version
          rollingGranularity: 'month',
        },
      });
      const result = validateBundle(bundle);
      expect(result.valid).toBe(true);
    });

    it('importBundle with old toolVersion creates snapshot successfully', () => {
      const bundle = makeMinimalBundle({
        metadata: {
          exportTimestamp: '2024-05-01T10:00:00Z',
          startDate: '2023-05-01T00:00:00Z',
          endDate: '2024-05-01T00:00:00Z',
          aiMarkerDate: null,
          tenureMode: 'global',
          repoIds: [42],
          repoNames: ['legacy/repo'],
          cohortConfig: DEFAULT_COHORT_CONFIG,
          toolVersion: '0.0.1',
          rollingGranularity: 'month',
        },
      });

      let result: Awaited<ReturnType<typeof importBundle>>;
      expect(() => {
        result = importBundle(bundle, null, 'file', 'Legacy Org v0.0.1');
      }).not.toThrow();
      expect(result!.orgId).toBeGreaterThan(0);
      expect(result!.snapshotId).toBeGreaterThan(0);
    });
  });
});
