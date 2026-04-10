/**
 * AI signal detection tests.
 * Tests that adopting orgs show before/after AI signal.
 * Tests that pre-AI baseline orgs (control group) show no false positive.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { vi } from 'vitest';
import * as schema from '../db/schema.js';

function createSignalTestDb() {
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

  const db = drizzle(sqlite, { schema });

  // AI-adopting org (ID=10): has AI marker date, shows before/after pattern
  db.insert(schema.orgs).values(
    { id: 10, label: 'AI Adopting Co', sizeCategory: 'medium', importSource: 'file', createdAt: Date.now() }
  ).run();
  db.insert(schema.snapshots).values(
    { id: 10, orgId: 10, importTimestamp: Date.now(), metadataJson: '{}', aiMarkerDate: '2025-06-01', contributorCount: 50, repoCount: 10 }
  ).run();

  // Before AI: lower commit sizes
  for (const month of ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05']) {
    sqlite.prepare(`
      INSERT INTO cohort_metrics (snapshot_id, org_id, metric_type, cohort, period, period_month, avg_lines_added, avg_lines_deleted, avg_files_changed, total_count, contributor_count)
      VALUES (10, 10, 'commits', 'new', 'before', ?, 80, 40, 3, 200, 50)
    `).run(month);
  }

  // After AI: higher commit sizes (~100% larger)
  for (const month of ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11']) {
    sqlite.prepare(`
      INSERT INTO cohort_metrics (snapshot_id, org_id, metric_type, cohort, period, period_month, avg_lines_added, avg_lines_deleted, avg_files_changed, total_count, contributor_count)
      VALUES (10, 10, 'commits', 'new', 'after', ?, 160, 80, 6, 250, 50)
    `).run(month);
  }

  // Pre-AI baseline org (ID=11): NO AI marker date, flat steady metrics
  db.insert(schema.orgs).values(
    { id: 11, label: 'Pre-AI Baseline', sizeCategory: 'medium', importSource: 'file', createdAt: Date.now() }
  ).run();
  db.insert(schema.snapshots).values(
    { id: 11, orgId: 11, importTimestamp: Date.now(), metadataJson: '{}', aiMarkerDate: null, contributorCount: 30, repoCount: 8 }
  ).run();

  // Steady metrics, no inflection point
  for (const month of ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08']) {
    sqlite.prepare(`
      INSERT INTO cohort_metrics (snapshot_id, org_id, metric_type, cohort, period, period_month, avg_lines_added, avg_lines_deleted, avg_files_changed, total_count, contributor_count)
      VALUES (11, 11, 'commits', 'new', 'all', ?, 100, 50, 4, 150, 30)
    `).run(month);
  }

  return { db, sqlite };
}

const { db: signalTestDb, sqlite: signalSqlite } = createSignalTestDb();

vi.mock('../db/client.js', () => ({
  db: signalTestDb,
  sqlite: signalSqlite,
}));

// Import services AFTER mock
const { getAggregatedCohortMetrics, getOrgComparisonTable } = await import('../services/aggregation.js');

describe('AI signal detection', () => {
  it('AI-adopting org shows before/after signal: "after" period has higher avg commit size than "before"', () => {
    const allRows = getAggregatedCohortMetrics('weighted', [10], 'commits');

    const beforeRows = allRows.filter(r => r.period === 'before');
    const afterRows = allRows.filter(r => r.period === 'after');

    expect(beforeRows.length).toBeGreaterThan(0);
    expect(afterRows.length).toBeGreaterThan(0);

    const avgBefore = beforeRows.reduce((s, r) => s + r.avgLinesAdded, 0) / beforeRows.length;
    const avgAfter = afterRows.reduce((s, r) => s + r.avgLinesAdded, 0) / afterRows.length;

    // After AI adoption, commit sizes should be higher
    expect(avgAfter).toBeGreaterThan(avgBefore);
    // ~100% increase (80 -> 160)
    expect((avgAfter - avgBefore) / avgBefore).toBeGreaterThan(0.5);
  });

  it('pre-AI baseline org snapshot has null ai_marker_date', () => {
    const snapshotRow = signalSqlite.prepare(
      'SELECT ai_marker_date FROM snapshots WHERE org_id = ?'
    ).get(11) as { ai_marker_date: string | null };

    expect(snapshotRow).toBeDefined();
    expect(snapshotRow.ai_marker_date).toBeNull();
  });

  it('cross-org aggregation excluding pre-AI baseline still shows AI signal from adopting org', () => {
    // Only include the AI-adopting org, not the baseline
    const rows = getAggregatedCohortMetrics('weighted', [10], 'commits');

    const beforeRows = rows.filter(r => r.period === 'before');
    const afterRows = rows.filter(r => r.period === 'after');

    expect(beforeRows.length).toBeGreaterThan(0);
    expect(afterRows.length).toBeGreaterThan(0);

    const avgBefore = beforeRows.reduce((s, r) => s + r.avgLinesAdded, 0) / beforeRows.length;
    const avgAfter = afterRows.reduce((s, r) => s + r.avgLinesAdded, 0) / afterRows.length;

    // Signal is present: after is larger than before
    expect(avgAfter).toBeGreaterThan(avgBefore);
  });

  it('pre-AI baseline in comparison table shows null ai_marker_date', () => {
    const rows = getOrgComparisonTable([11]);
    expect(rows).toHaveLength(1);
    expect(rows[0].aiMarkerDate).toBeNull();
  });
});
