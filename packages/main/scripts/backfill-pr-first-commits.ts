/**
 * Phase 9.6 D-12 (path b): one-shot backfill for pull_requests.first_commit_at on legacy PRs.
 *
 * Run with: npm run backfill-pr-first-commits
 *
 * For each PR with first_commit_at IS NULL, calls fetchPrFirstCommit and persists the result.
 * Fail-soft: per-PR failures log a warning and skip to next; the script does not abort the batch.
 *
 * No collection_state row, no UI affordance — this is a CLI-only one-off (D-13). When real
 * users arrive (per memory project_no_real_users_yet), revisit a permanent backfill UI.
 *
 * Idempotency: re-running on a fully-backfilled DB is a no-op (the SELECT returns 0 rows).
 * Re-running with new PRs added since the last run only processes the new NULLs.
 *
 * Methodology divergence from LDX3: fetchPrFirstCommit returns MIN(authoredDate, committedDate)
 * across all PR commits, NOT pure committedDate. Preserves true 'work started' through rebases.
 * See .planning/phases/09.6-cycle-time-correction-inserted/09.6-CONTEXT.md (D-02).
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fetchPrFirstCommit } from '../server/services/pr-first-commit.js';
import { createOctokit } from '../server/services/octokit.js';

async function main() {
  const dbPath = process.env.DB_PATH ?? path.resolve(process.cwd(), 'data/app.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  console.log(`[backfill] opening ${dbPath}`);

  // Resolve PRs that need backfill — join repositories for owner/name.
  // Only NULL first_commit_at rows are returned (idempotency).
  const candidates = sqlite
    .prepare(
      `
      SELECT pr.id AS pr_id, pr.number AS pr_number, r.owner_login AS owner, r.name AS repo
      FROM pull_requests pr
      INNER JOIN repositories r ON r.id = pr.repo_id
      WHERE pr.first_commit_at IS NULL
      ORDER BY pr.id
    `,
    )
    .all() as Array<{ pr_id: number; pr_number: number; owner: string; repo: string }>;

  console.log(`[backfill] ${candidates.length} PR(s) need first_commit_at`);

  if (candidates.length === 0) {
    sqlite.close();
    console.log('[backfill] nothing to do');
    return;
  }

  const octokit = createOctokit();
  if (!octokit) {
    console.error('[backfill] no octokit instance — GitHub token may be missing or invalid');
    sqlite.close();
    process.exit(1);
  }

  // Prepared UPDATE — parameterized, integer-only crosses the boundary (T-09.6.11-01 mitigation)
  const updateStmt = sqlite.prepare(`UPDATE pull_requests SET first_commit_at = ? WHERE id = ?`);

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  const PROGRESS_INTERVAL = 25;
  const startedAt = Date.now();

  for (let i = 0; i < candidates.length; i++) {
    const row = candidates[i];
    try {
      const date = await fetchPrFirstCommit(octokit, row.owner, row.repo, row.pr_number);
      if (date === null) {
        // 0-commit PR (D-04), fetch failure (D-03), or 404 — leave first_commit_at NULL.
        // The cycle-time metric naturally excludes NULL rows via the IS NOT NULL filter.
        skipped += 1;
      } else {
        // Store as epoch seconds (matches Drizzle mode:'timestamp' integer column).
        const epochSeconds = Math.floor(date.getTime() / 1000);
        updateStmt.run(epochSeconds, row.pr_id);
        ok += 1;
      }
    } catch (err) {
      // pr-first-commit.ts is already fail-soft (any throw returns null), but defense-in-depth:
      // a programmer bug in the helper, an out-of-memory error, or an unhandled rejection
      // should not abort the batch.
      console.warn(
        `[backfill] failed for ${row.owner}/${row.repo}#${row.pr_number}:`,
        err,
      );
      failed += 1;
    }
    if ((i + 1) % PROGRESS_INTERVAL === 0) {
      const elapsed = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `[backfill] ${i + 1}/${candidates.length} (ok=${ok}, skipped=${skipped}, failed=${failed}, ${elapsed}s elapsed)`,
      );
    }
  }

  sqlite.close();
  console.log(
    `[backfill] done — ok=${ok}, skipped=${skipped}, failed=${failed}, total=${candidates.length}`,
  );
}

main().catch((err) => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
