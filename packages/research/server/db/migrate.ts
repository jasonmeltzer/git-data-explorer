import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, sqlite } from './client.js';

/**
 * Pre-populate __drizzle_migrations with a sentinel row for migration 0000 when:
 *   - the `orgs` table already exists (DB was created before drizzle adoption)
 *   - AND `__drizzle_migrations` does NOT yet exist
 *
 * This lets drizzle's migrate() skip 0000 (CREATE TABLE — would fail on existing tables)
 * and apply 0001 (DROP COLUMN legacy columns) on existing research.db installations.
 *
 * Schema of __drizzle_migrations verified at runtime by drizzle-journal-shape.test.ts (A2 evidence).
 * drizzle-orm 0.45.x emits `SERIAL PRIMARY KEY` (not `INTEGER PRIMARY KEY AUTOINCREMENT`).
 * Using SERIAL here ensures the bootstrap table matches what drizzle would create natively.
 *
 * IMPORTANT: drizzle's migrator skips a migration when:
 *   `lastDbMigration.created_at >= migration.folderMillis`
 * where `folderMillis` is the `when` field from _journal.json for that entry.
 * So the sentinel's `created_at` MUST equal (not just be > 0) the 0000 entry's `when`
 * timestamp. We read that value from the journal at bootstrap time.
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
  const hasJournal = target
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'`)
    .get();

  if (hasOrgs && !hasJournal) {
    // Read the 0000 entry's `when` timestamp from the journal so the sentinel
    // created_at exactly matches 0000's folderMillis. drizzle compares
    // `lastDbMigration.created_at >= migration.folderMillis` to decide whether
    // to skip — using the wrong timestamp causes 0000 to re-run and fail with
    // "table already exists".
    const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };
    const entry0 = journal.entries.find((e) => e.idx === 0);
    if (!entry0) {
      throw new Error('bootstrapMigrationJournal: journal has no entry with idx=0');
    }

    // Create the journal table using the same schema drizzle-orm 0.45.x emits natively.
    // SERIAL here is the SQLite type alias drizzle uses; it stores as INTEGER under the hood.
    target.exec(`
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at numeric
      );
    `);
    target
      .prepare(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`)
      .run('bootstrapped-0000', entry0.when);
  }
}

/**
 * Apply all pending Drizzle migrations to the database.
 *
 * On fresh installs: bootstrapMigrationJournal() is a no-op (no orgs table yet),
 *   drizzle creates __drizzle_migrations itself, then runs 0000 + 0001.
 *
 * On existing research.db (no journal): bootstrapMigrationJournal() pre-seeds 0000
 *   as applied, then drizzle runs only 0001 (drops legacy columns).
 *
 * On already-migrated DBs: both steps are no-ops (journal exists, all migrations applied).
 */
export function runMigrations(): void {
  // Resolve relative to this file so the path works whether the server runs from
  // packages/research/ or from the repo root.
  const __fileDirname = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(__fileDirname, '..', '..', 'drizzle', 'migrations');

  bootstrapMigrationJournal(sqlite, migrationsFolder);
  migrate(db, { migrationsFolder });
}
