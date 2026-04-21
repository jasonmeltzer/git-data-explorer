/**
 * Tests the bootstrapMigrationJournal() path in migrate.ts:
 * simulates a legacy research.db (pre-phase-9.4) that has orgs/snapshots tables
 * but NO __drizzle_migrations journal. Verifies that runMigrations() / bootstrapMigrationJournal()
 * correctly pre-seeds the journal and applies only 0001 (drop legacy columns).
 *
 * IMPORTANT: The LEGACY_DDL fixture below is a SYNTHETIC representation of
 * the pre-9.4 research.db schema. It is NOT a copy of packages/research/server/index.ts
 * as it exists today. The current index.ts no longer has industry/ai_tool on orgs.
 * This fixture deliberately includes those columns to simulate what a real legacy
 * installation looks like on disk.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapMigrationJournal } from '../db/migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle', 'migrations');

// SYNTHETIC legacy DDL — represents a pre-phase-9.4 research.db installation.
// NOT a reflection of the current packages/research/server/index.ts.
// Key differences from current index.ts:
//   - orgs has `industry TEXT` and `ai_tool TEXT` (SYNTHETIC legacy columns — pre-9.4 only)
//   - snapshots has `before_after_json TEXT` (still present in current index.ts; dropped by 0001)
// All other tables mirror what the real legacy DB would have had.
const LEGACY_DDL = `
  CREATE TABLE orgs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    industry TEXT,
    ai_tool TEXT,
    size_category TEXT,
    import_source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE snapshots (
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
  CREATE TABLE cohort_metrics (
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
  CREATE TABLE ramp_up (
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
  CREATE TABLE rolling_comparisons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    data_json TEXT NOT NULL
  );
  CREATE TABLE contributors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    author_login TEXT NOT NULL,
    cohort TEXT NOT NULL,
    first_commit_at TEXT,
    pre_json TEXT,
    post_json TEXT
  );
  CREATE TABLE pr_turnaround (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    avg_hours_to_merge REAL NOT NULL DEFAULT 0,
    median_hours_to_merge REAL NOT NULL DEFAULT 0,
    pr_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE bot_ratio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    period_month TEXT NOT NULL,
    bot_commits INTEGER NOT NULL DEFAULT 0,
    human_commits INTEGER NOT NULL DEFAULT 0,
    total_commits INTEGER NOT NULL DEFAULT 0,
    bot_percentage REAL NOT NULL DEFAULT 0
  );
  CREATE TABLE concentration_monthly (
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
  CREATE TABLE headcount_monthly (
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
  CREATE TABLE period_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
    org_id INTEGER NOT NULL REFERENCES orgs(id),
    data_json TEXT NOT NULL
  );
`;

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  // Set up legacy state: tables exist, no __drizzle_migrations journal
  sqlite.exec(LEGACY_DDL);
});

afterEach(() => {
  sqlite.close();
});

describe('migration bootstrap for legacy research.db', () => {
  test('before_after_json is present in snapshots BEFORE migration (fixture verification)', () => {
    const cols = sqlite
      .prepare(`PRAGMA table_info(snapshots)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('before_after_json');
  });

  test('industry is present in orgs BEFORE migration (SYNTHETIC legacy fixture)', () => {
    const cols = sqlite
      .prepare(`PRAGMA table_info(orgs)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('industry');
  });

  test('before_after_json is GONE from snapshots AFTER runMigrations bootstrap', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const cols = sqlite
      .prepare(`PRAGMA table_info(snapshots)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('before_after_json');
  });

  test('industry is GONE from orgs AFTER runMigrations bootstrap', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const cols = sqlite
      .prepare(`PRAGMA table_info(orgs)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('industry');
  });

  test('ai_tool is GONE from orgs AFTER runMigrations bootstrap', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const cols = sqlite
      .prepare(`PRAGMA table_info(orgs)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).not.toContain('ai_tool');
  });

  test('__drizzle_migrations has 2 rows after bootstrap (bootstrapped-0000 + 0001 hash)', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const rows = sqlite
      .prepare(`SELECT hash FROM __drizzle_migrations ORDER BY id`)
      .all() as Array<{ hash: string }>;

    expect(rows.length).toBe(2);
    expect(rows[0].hash).toBe('bootstrapped-0000');
    // Row 1 is a hash drizzle generates for 0001_drop_legacy_columns.sql
    expect(typeof rows[1].hash).toBe('string');
    expect(rows[1].hash.length).toBeGreaterThan(0);
  });

  test('running bootstrapMigrationJournal + migrate twice is idempotent', () => {
    const db = drizzle(sqlite);

    // First run
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const countBefore = (sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number }).n;

    // Second run
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const countAfter = (sqlite
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations`)
      .get() as { n: number }).n;

    expect(countAfter).toBe(countBefore);
  });
});
