import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Guards against drift between packages/research/server/index.ts (runtime
// CREATE TABLE IF NOT EXISTS block) and packages/research/server/db/schema.ts
// (Drizzle schema, canonical definition). If schema.ts gains a new table and
// index.ts isn't updated, fresh installs crash on INSERT with "no such table".

const EXPECTED_TABLES = [
  'orgs',
  'snapshots',
  'cohort_metrics',
  'ramp_up',
  'rolling_comparisons',
  'contributors',
  'pr_turnaround',
  'bot_ratio',
  'concentration_monthly',
  'headcount_monthly',
  'period_metrics',
];

function extractExecBlock(indexTsPath: string): string {
  const src = fs.readFileSync(indexTsPath, 'utf-8');
  const match = src.match(/sqlite\.exec\(`([\s\S]*?)`\)/);
  if (!match) throw new Error('Could not locate sqlite.exec block in index.ts');
  return match[1];
}

function freshDb(): Database.Database {
  const indexPath = path.resolve(__dirname, '..', 'index.ts');
  const db = new Database(':memory:');
  db.exec(extractExecBlock(indexPath));
  return db;
}

describe('research fresh-install schema', () => {
  test('index.ts exec block creates all tables declared in schema.ts', () => {
    const db = freshDb();
    const rows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<{ name: string }>;
    const actual = rows.map((r) => r.name);
    expect(actual.sort()).toEqual([...EXPECTED_TABLES].sort());
    db.close();
  });

  test('concentration_monthly has the expected columns (Phase 9.4)', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(concentration_monthly)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'active_devs',
        'basis',
        'bus_factor',
        'gini',
        'hhi',
        'id',
        'org_id',
        'period_month',
        'snapshot_id',
        'top1_share',
        'top3_share',
        'top5_share',
        'top_contributor',
      ].sort()
    );
    db.close();
  });

  test('headcount_monthly has the expected columns (Phase 9.4)', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(headcount_monthly)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'active_devs',
        'commits_per_dev',
        'id',
        'org_id',
        'period_month',
        'prs_per_dev',
        'snapshot_id',
        'total_commits',
        'total_prs',
      ].sort()
    );
    db.close();
  });

  test('period_metrics has the expected columns (Phase 9.4)', () => {
    const db = freshDb();
    const cols = db.prepare(`PRAGMA table_info(period_metrics)`).all() as Array<{ name: string }>;
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual(['data_json', 'id', 'org_id', 'snapshot_id'].sort());
    db.close();
  });

  test('required Phase 9.4 indexes exist', () => {
    const db = freshDb();
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('idx_concentration_monthly_org');
    expect(names).toContain('idx_headcount_monthly_org');
    db.close();
  });

  test('inserting into Phase 9.4 tables succeeds end-to-end', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO orgs (label, created_at) VALUES (?, ?)`
    ).run('Test Org', Date.now());
    const orgId = db.prepare(`SELECT id FROM orgs WHERE label = 'Test Org'`).get() as { id: number };
    db.prepare(
      `INSERT INTO snapshots (org_id, import_timestamp, metadata_json) VALUES (?, ?, ?)`
    ).run(orgId.id, Date.now(), '{}');
    const snap = db.prepare(`SELECT id FROM snapshots LIMIT 1`).get() as { id: number };

    // The actual regression guard — these inserts would throw "no such table"
    // on the pre-fix index.ts.
    expect(() => {
      db.prepare(
        `INSERT INTO concentration_monthly (snapshot_id, org_id, basis, period_month, active_devs) VALUES (?, ?, ?, ?, ?)`
      ).run(snap.id, orgId.id, 'prs', '2025-06', 8);
    }).not.toThrow();

    expect(() => {
      db.prepare(
        `INSERT INTO headcount_monthly (snapshot_id, org_id, period_month, active_devs, total_prs, total_commits) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(snap.id, orgId.id, '2025-06', 8, 30, 150);
    }).not.toThrow();

    expect(() => {
      db.prepare(
        `INSERT INTO period_metrics (snapshot_id, org_id, data_json) VALUES (?, ?, ?)`
      ).run(snap.id, orgId.id, '[]');
    }).not.toThrow();

    db.close();
  });
});
