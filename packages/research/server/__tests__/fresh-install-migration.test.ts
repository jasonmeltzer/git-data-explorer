/**
 * Verifies that applying migrations to a fresh :memory: DB produces the
 * canonical schema.ts-equivalent schema (no legacy columns, all 12 tables).
 *
 * This replaces fresh-install.test.ts which used fragile regex extraction
 * from index.ts. Migration-based testing is authoritative.
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

const EXPECTED_TABLES = [
  'bot_ratio',
  'cohort_metrics',
  'concentration_monthly',
  'contributors',
  'developer_monthly',
  'headcount_monthly',
  'orgs',
  'period_metrics',
  'pr_turnaround',
  'ramp_up',
  'rolling_comparisons',
  'snapshots',
];

let sqlite: Database.Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
});

afterEach(() => {
  sqlite.close();
});

describe('fresh-install via migration', () => {
  test('all 12 schema.ts tables exist after applying migrations', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const rows = sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table'
           AND name NOT LIKE 'sqlite_%'
           AND name != '__drizzle_migrations'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>;

    expect(rows.map((r) => r.name).sort()).toEqual(EXPECTED_TABLES);
  });

  test('snapshots table has NO before_after_json column after migration', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const cols = sqlite
      .prepare(`PRAGMA table_info(snapshots)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    expect(colNames).not.toContain('before_after_json');
  });

  test('orgs table has NO industry column after migration', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const cols = sqlite
      .prepare(`PRAGMA table_info(orgs)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    expect(colNames).not.toContain('industry');
  });

  test('orgs table has NO ai_tool column after migration', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const cols = sqlite
      .prepare(`PRAGMA table_info(orgs)`)
      .all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);

    expect(colNames).not.toContain('ai_tool');
  });

  test('concentration_monthly index exists after migration', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const indexes = sqlite
      .prepare(`PRAGMA index_list(concentration_monthly)`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);

    expect(names).toContain('idx_concentration_monthly_org');
  });

  test('headcount_monthly index exists after migration', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const indexes = sqlite
      .prepare(`PRAGMA index_list(headcount_monthly)`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);

    expect(names).toContain('idx_headcount_monthly_org');
  });

  test('positive insert into org + snapshot + concentration_monthly succeeds', () => {
    const db = drizzle(sqlite);
    bootstrapMigrationJournal(sqlite, MIGRATIONS_FOLDER);
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    sqlite.prepare(`INSERT INTO orgs (label, created_at) VALUES (?, ?)`).run('Test Org', Date.now());
    const org = sqlite.prepare(`SELECT id FROM orgs WHERE label = 'Test Org'`).get() as { id: number };

    sqlite
      .prepare(
        `INSERT INTO snapshots (org_id, import_timestamp, metadata_json) VALUES (?, ?, ?)`
      )
      .run(org.id, Date.now(), '{}');
    const snap = sqlite.prepare(`SELECT id FROM snapshots LIMIT 1`).get() as { id: number };

    expect(() => {
      sqlite
        .prepare(
          `INSERT INTO concentration_monthly (snapshot_id, org_id, basis, period_month, active_devs) VALUES (?, ?, ?, ?, ?)`
        )
        .run(snap.id, org.id, 'prs', '2025-06', 8);
    }).not.toThrow();
  });
});
