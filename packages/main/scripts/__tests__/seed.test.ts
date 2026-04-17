import { describe, test, expect } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Seed data validation tests (D-16).
 *
 * These tests verify that the seeded SQLite database contains the specific
 * scenario patterns required for Team Distribution analytics:
 *   - A dominant-contributor period (top-1 contributor >= 45% of commits
 *     for at least 3 consecutive months)
 *   - A team-size increase event (3+ new joiners in the same 2-month window)
 *   - A team-size decrease event (2+ departures in the same month)
 *   - Multi-cohort active team concurrent in a single month
 *
 * IMPORTANT: These tests require a seeded database to run.
 * To run these tests:
 *   npm run seed && npx vitest run packages/main/scripts/__tests__/seed.test.ts
 *
 * They are not run in the standard CI suite (which uses :memory: DBs).
 * They are integration smoke tests against the seeded fixture data.
 *
 * The whole suite is skipped when data/seed.db is absent so the normal
 * test run stays green without a prior `npm run seed`.
 */

// Resolve relative to this file so the test works regardless of cwd
// (seed script writes to packages/main/data/seed.db per its own process.cwd()).
const SEED_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'seed.db');
const seedExists = fs.existsSync(SEED_DB_PATH);
const d = seedExists ? describe : describe.skip;

function openSeedDb(): Database.Database {
  const db = new Database(SEED_DB_PATH, { readonly: true });
  db.pragma('foreign_keys = ON');
  return db;
}

interface MonthlyShareRow {
  month: string;
  login: string;
  commits: number;
  total_in_month: number;
  share: number;
}

function getMonthlyTopContributor(db: Database.Database): MonthlyShareRow[] {
  // For each month, find the top human contributor's share of total commits
  // across all repos. Matches analytics-concentration's "commits basis" shape.
  return db.prepare(`
    WITH monthly_by_author AS (
      SELECT
        strftime('%Y-%m', c.committed_at, 'unixepoch') AS month,
        a.github_login AS login,
        COUNT(*) AS commits
      FROM commits c
      JOIN authors a ON a.id = c.author_id
      WHERE a.is_bot = 0
      GROUP BY month, a.id
    ),
    monthly_total AS (
      SELECT month, SUM(commits) AS total
      FROM monthly_by_author
      GROUP BY month
    ),
    ranked AS (
      SELECT
        ma.month,
        ma.login,
        ma.commits,
        mt.total AS total_in_month,
        CAST(ma.commits AS REAL) / mt.total AS share,
        ROW_NUMBER() OVER (PARTITION BY ma.month ORDER BY ma.commits DESC) AS rank
      FROM monthly_by_author ma
      JOIN monthly_total mt ON mt.month = ma.month
    )
    SELECT month, login, commits, total_in_month, share
    FROM ranked
    WHERE rank = 1
    ORDER BY month
  `).all() as MonthlyShareRow[];
}

// ── seed data dominant-contributor (D-16) ────────────────────────────────────

d('seed data dominant-contributor (D-16)', () => {
  test('at least 3 consecutive months where one contributor has >= 45% of commits', () => {
    const db = openSeedDb();
    try {
      const topByMonth = getMonthlyTopContributor(db);
      // Find the longest run of consecutive months where top-1 share >= 0.45
      let maxRun = 0;
      let currentRun = 0;
      for (const row of topByMonth) {
        if (row.share >= 0.45) {
          currentRun += 1;
          if (currentRun > maxRun) maxRun = currentRun;
        } else {
          currentRun = 0;
        }
      }
      expect(maxRun, `top monthly shares: ${JSON.stringify(topByMonth.map(r => ({ month: r.month, login: r.login, share: Math.round(r.share * 1000) / 10 })))}`).toBeGreaterThanOrEqual(3);
    } finally {
      db.close();
    }
  });

  test('dominant contributor during window is alexpower (the D-16 persona)', () => {
    const db = openSeedDb();
    try {
      const topByMonth = getMonthlyTopContributor(db);
      // Filter to months where the top-1 share >= 45% — these are the "dominant" months
      const dominantMonths = topByMonth.filter(r => r.share >= 0.45);
      // The configured dominant persona is alexpower; at least one of the dominant
      // months must have them as top-1. (alexpower is active weeks 6-22 → months 3-5.)
      const alexDominant = dominantMonths.filter(r => r.login === 'alexpower');
      expect(alexDominant.length).toBeGreaterThanOrEqual(3);
    } finally {
      db.close();
    }
  });
});

// ── seed data team-size events ────────────────────────────────────────────────

d('seed data team-size events (D-16)', () => {
  test('team-size increase event: 3 or more joiners in the same 2-month window', () => {
    const db = openSeedDb();
    try {
      // First-commit month per human author
      const firstCommits = db.prepare(`
        SELECT
          a.github_login AS login,
          strftime('%Y-%m', MIN(CAST(c.committed_at AS INTEGER)), 'unixepoch') AS first_month
        FROM authors a
        JOIN commits c ON c.author_id = a.id
        WHERE a.is_bot = 0
        GROUP BY a.id
      `).all() as Array<{ login: string; first_month: string }>;

      // Group by month and count joiners
      const joinersByMonth = new Map<string, number>();
      for (const r of firstCommits) {
        joinersByMonth.set(r.first_month, (joinersByMonth.get(r.first_month) ?? 0) + 1);
      }

      // Scan for any 2-month rolling window with >=3 joiners
      const months = Array.from(joinersByMonth.keys()).sort();
      let maxWindowJoiners = 0;
      for (let i = 0; i < months.length; i++) {
        const thisMonth = joinersByMonth.get(months[i]) ?? 0;
        const nextMonth = i + 1 < months.length ? (joinersByMonth.get(months[i + 1]) ?? 0) : 0;
        // Only count neighbors if they're actually adjacent calendar months
        const adjacent = i + 1 < months.length && isAdjacentMonth(months[i], months[i + 1]);
        const windowSum = adjacent ? thisMonth + nextMonth : thisMonth;
        if (windowSum > maxWindowJoiners) maxWindowJoiners = windowSum;
      }
      expect(maxWindowJoiners).toBeGreaterThanOrEqual(3);
    } finally {
      db.close();
    }
  });

  test('team-size decrease event: 2 or more devs have their last-commit in the same month', () => {
    const db = openSeedDb();
    try {
      // Last-commit month per human author
      const lastCommits = db.prepare(`
        SELECT
          a.github_login AS login,
          strftime('%Y-%m', MAX(CAST(c.committed_at AS INTEGER)), 'unixepoch') AS last_month
        FROM authors a
        JOIN commits c ON c.author_id = a.id
        WHERE a.is_bot = 0
        GROUP BY a.id
      `).all() as Array<{ login: string; last_month: string }>;

      // Only count as "leavers" devs whose last commit is clearly before the
      // data end (so they actually stopped, rather than still being active).
      const dataEnd = db.prepare(`
        SELECT strftime('%Y-%m', MAX(CAST(committed_at AS INTEGER)), 'unixepoch') AS last_month FROM commits
      `).get() as { last_month: string };

      const leaversByMonth = new Map<string, number>();
      for (const r of lastCommits) {
        if (r.last_month >= dataEnd.last_month) continue; // still active
        leaversByMonth.set(r.last_month, (leaversByMonth.get(r.last_month) ?? 0) + 1);
      }

      const maxLeaversInMonth = Math.max(0, ...leaversByMonth.values());
      expect(maxLeaversInMonth).toBeGreaterThanOrEqual(2);
    } finally {
      db.close();
    }
  });
});

// ── seed data multi-cohort coverage ──────────────────────────────────────────

d('seed data multi-cohort coverage (D-16)', () => {
  test('at least one month has concurrent 0-3mo, 3-12mo, and 1yr+ tenure contributors', () => {
    const db = openSeedDb();
    try {
      // For each (month, author), compute months since the author's first commit
      // using the global first-commit (same shape as cohort analytics "global" tenure).
      const rows = db.prepare(`
        WITH author_first AS (
          SELECT author_id, MIN(CAST(committed_at AS INTEGER)) AS first_commit_epoch
          FROM commits
          GROUP BY author_id
        ),
        monthly_author AS (
          SELECT
            strftime('%Y-%m', c.committed_at, 'unixepoch') AS month,
            c.author_id AS author_id,
            (CAST(c.committed_at AS INTEGER) - af.first_commit_epoch) / (86400.0 * 30) AS tenure_months
          FROM commits c
          JOIN authors a ON a.id = c.author_id
          JOIN author_first af ON af.author_id = c.author_id
          WHERE a.is_bot = 0
        )
        SELECT
          month,
          SUM(CASE WHEN tenure_months < 3  THEN 1 ELSE 0 END) AS new_count,
          SUM(CASE WHEN tenure_months >= 3 AND tenure_months < 12 THEN 1 ELSE 0 END) AS mid_count,
          SUM(CASE WHEN tenure_months >= 12 THEN 1 ELSE 0 END) AS senior_count
        FROM (SELECT DISTINCT month, author_id, tenure_months FROM monthly_author)
        GROUP BY month
      `).all() as Array<{ month: string; new_count: number; mid_count: number; senior_count: number }>;

      const anyMultiCohortMonth = rows.some(r => r.new_count > 0 && r.mid_count > 0 && r.senior_count > 0);
      expect(anyMultiCohortMonth).toBe(true);
    } finally {
      db.close();
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdjacentMonth(a: string, b: string): boolean {
  // a, b are 'YYYY-MM' strings; true if b is a + 1 month
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  const totalA = ay * 12 + am;
  const totalB = by * 12 + bm;
  return totalB - totalA === 1;
}
