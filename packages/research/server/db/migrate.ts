import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, sqlite } from './client.js';

/**
 * Returns the names of columns present in a given table, or [] if the table doesn't exist.
 */
function getColumnNames(target: InstanceType<typeof BetterSqlite3>, tableName: string): string[] {
  const rows = target
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Pre-populate __drizzle_migrations for legacy research.db installations that were
 * created by the old `sqlite.exec()` block in server/index.ts (before drizzle adoption).
 *
 * Handles all legacy DB states:
 *
 * State A — Fully pre-migration (no journal, all legacy cols still present):
 *   - orgs has: id, label, industry, ai_tool, size_category, import_source, created_at
 *   - snapshots has: ..., before_after_json
 *   → Create journal, mark 0000 applied; let drizzle run 0001 (drops all 3 cols).
 *
 * State B — Partially migrated (no journal OR partial journal; industry/ai_tool gone):
 *   - orgs has: id, label, size_category, import_source, created_at   (no industry/ai_tool)
 *   - snapshots has: ..., before_after_json
 *   → Ensure journal exists with 0000 marked applied; manually drop before_after_json;
 *     insert 0001 sentinel so drizzle skips it. (Cannot let drizzle run 0001 — DROP COLUMN
 *     industry would fail on already-dropped col.)
 *
 * State C — Fully migrated (journal exists, before_after_json gone):
 *   → No-op.
 *
 * State D — Fresh install (no orgs table yet):
 *   → No-op; drizzle creates journal and runs 0000+0001 on a clean DB.
 *
 * Schema of __drizzle_migrations verified at runtime by drizzle-journal-shape.test.ts (A2 evidence).
 * drizzle-orm 0.45.x emits `SERIAL PRIMARY KEY` (not `INTEGER PRIMARY KEY AUTOINCREMENT`).
 *
 * IMPORTANT: drizzle's migrator skips a migration when:
 *   `lastDbMigration.created_at >= migration.folderMillis`
 * where `folderMillis` is the `when` field from _journal.json. Sentinel created_at values
 * must match journal entry timestamps exactly.
 *
 * @param target           - The better-sqlite3 Database instance to operate on
 * @param migrationsFolder - Path to the migrations folder (to read journal timestamps)
 */
export function bootstrapMigrationJournal(
  target: InstanceType<typeof BetterSqlite3>,
  migrationsFolder: string
): void {
  const hasOrgs = target
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='orgs'`)
    .get();

  // State D: fresh install — nothing to bootstrap, drizzle handles it
  if (!hasOrgs) return;

  const snapCols = getColumnNames(target, 'snapshots');
  const hasBeforeAfter = snapCols.includes('before_after_json');

  // State C: already fully migrated (no legacy col remaining)
  if (!hasBeforeAfter) return;

  // Read journal timestamps so sentinels match drizzle's folderMillis comparisons.
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };
  const entry0 = journal.entries.find((e) => e.idx === 0);
  const entry1 = journal.entries.find((e) => e.idx === 1);
  if (!entry0) {
    throw new Error('bootstrapMigrationJournal: journal has no entry with idx=0');
  }

  const hasJournal = target
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get();

  if (!hasJournal) {
    // Create the journal table matching drizzle-orm 0.45.x schema (SERIAL, not INTEGER).
    target.exec(`
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at numeric
      );
    `);
    // Mark 0000 as applied (tables already exist from old sqlite.exec() block).
    target
      .prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`)
      .run('bootstrapped-0000', entry0.when);
  }

  // Detect State B: industry/ai_tool already dropped (by old try/catch) but
  // before_after_json still present. We cannot let drizzle run 0001 as-is because
  // `DROP COLUMN industry` will fail on a col that's already gone.
  const orgCols = getColumnNames(target, 'orgs');
  const hasIndustry = orgCols.includes('industry');

  if (!hasIndustry && entry1) {
    // State B (with or without pre-existing partial journal):
    // Drop before_after_json manually and mark 0001 applied so drizzle skips it.
    target.exec(`ALTER TABLE snapshots DROP COLUMN before_after_json;`);
    // Only insert the 0001 sentinel if not already present (idempotency guard).
    const alreadyHas1 = (target
      .prepare(`SELECT COUNT(*) AS n FROM __drizzle_migrations WHERE created_at = ?`)
      .get(entry1.when) as { n: number }).n > 0;
    if (!alreadyHas1) {
      target
        .prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`)
        .run('bootstrapped-0001', entry1.when);
    }
  }
  // State A: all 3 legacy cols still present → let drizzle run 0001 normally.
}

/**
 * Apply all pending Drizzle migrations to the database.
 *
 * On fresh installs: bootstrapMigrationJournal() is a no-op (no orgs table yet),
 *   drizzle creates __drizzle_migrations itself, then runs 0000 + 0001.
 *
 * On legacy research.db (industry/ai_tool already dropped, before_after_json present):
 *   bootstrapMigrationJournal() manually drops before_after_json and marks both
 *   migrations as applied; drizzle's migrate() is then a no-op.
 *
 * On legacy research.db (all 3 legacy cols still present, no journal):
 *   bootstrapMigrationJournal() marks 0000 as applied; drizzle runs 0001 to drop all 3.
 *
 * On already-migrated DBs: both steps are no-ops (journal exists, before_after_json gone).
 */
export function runMigrations(): void {
  // Resolve relative to this file so the path works whether the server runs from
  // packages/research/ or from the repo root.
  const __fileDirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(__fileDirname, '..', '..', 'drizzle', 'migrations');

  bootstrapMigrationJournal(sqlite, migrationsFolder);
  migrate(db, { migrationsFolder });
}
