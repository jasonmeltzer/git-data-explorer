/**
 * Verifies the exact schema drizzle-orm creates for __drizzle_migrations.
 * This closes RESEARCH.md Assumption A2 — if drizzle ever changes the journal
 * schema, the bootstrap SQL in migrate.ts (Wave 1 Plan 03) breaks silently;
 * this test surfaces that break.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('__drizzle_migrations journal schema (A2 verification)', () => {
  it('drizzle migrate() creates __drizzle_migrations with expected columns', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite);

    // Create a throwaway migrations dir with zero migrations but valid _journal.json
    // so migrate() runs its bootstrap path without applying anything.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drizzle-journal-shape-'));
    const metaDir = path.join(tmpDir, 'meta');
    fs.mkdirSync(metaDir, { recursive: true });
    fs.writeFileSync(
      path.join(metaDir, '_journal.json'),
      JSON.stringify({ version: '7', dialect: 'sqlite', entries: [] })
    );

    // Running migrate with zero entries causes drizzle to create the journal table
    // even though no migration SQL runs.
    migrate(db, { migrationsFolder: tmpDir });

    // Now inspect the journal table drizzle created
    const cols = sqlite
      .prepare(`PRAGMA table_info(__drizzle_migrations)`)
      .all() as Array<{ cid: number; name: string; type: string; notnull: number; pk: number }>;

    expect(cols.length).toBeGreaterThan(0);

    const byName = Object.fromEntries(cols.map(c => [c.name, c]));

    // Bootstrap SQL in RESEARCH.md Pattern 7 assumed id type = INTEGER, but the
    // installed drizzle-orm (0.45.x) actually emits `SERIAL PRIMARY KEY`.
    // A2 FINDING: Use 'SERIAL' in any hand-rolled bootstrap DDL that must match
    // the drizzle journal table. If drizzle changes this in a future version,
    // this assertion fails and Wave 1 Plan 03 bootstrap SQL must be updated.
    expect(byName.id).toBeDefined();
    expect(byName.id.pk).toBe(1);
    // Verified at runtime: drizzle 0.45.x emits SERIAL (not INTEGER) for id column
    expect(byName.id.type.toUpperCase()).toBe('SERIAL');

    expect(byName.hash).toBeDefined();
    expect(byName.hash.type.toUpperCase()).toContain('TEXT');
    expect(byName.hash.notnull).toBe(1);

    expect(byName.created_at).toBeDefined();
    // Don't assert exact type on created_at — drizzle has used both NUMERIC and INTEGER across versions;
    // what matters is the bootstrap SQL stays compatible. Document the observed type.
    console.log('[A2] __drizzle_migrations schema:', JSON.stringify(cols, null, 2));

    sqlite.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
