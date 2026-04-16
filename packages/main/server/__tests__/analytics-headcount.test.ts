import { describe, test, vi } from 'vitest';

// ── Module mock (must be hoisted before service imports) ──────────────────────
vi.mock('../db/client.js', () => ({
  db: null,
  sqlite: null,
}));

// Service does not exist yet — RED state until Plan 02 creates it.
// Import path for Wave 1 implementation:
// import { getHeadcountMonthly } from '../services/analytics-headcount.js';

// ── active dev count ──────────────────────────────────────────────────────────

describe('active dev count', () => {
  /**
   * D-09: Active = commit-OR-PR author in the month, bots excluded (is_bot = 0).
   * An author who only commits (no PRs) still counts.
   * An author who only has PRs created/merged (no commits) still counts.
   */
  test.todo('commit-OR-PR authors are counted as active devs in a month (D-09)');
  test.todo('bots (is_bot=1) are excluded from active dev count (D-11)');
  test.todo('PR-only author (no commits that month) is counted as active (D-09)');
  test.todo('commit-only author (no PRs that month) is counted as active (D-09)');
  test.todo('same author with both commits and PRs is counted only once (D-09)');
});

// ── normalized output ─────────────────────────────────────────────────────────

describe('normalized output', () => {
  /**
   * D-12: prsPerDev = totalPrs / activeDevs (integer denominator, no day normalization).
   * commitsPerDev = totalCommits / activeDevs.
   */
  test.todo('prsPerDev = totalPrs / activeDevs with integer month denominator (D-12)');
  test.todo('commitsPerDev = totalCommits / activeDevs with integer month denominator (D-12)');
  test.todo('result row contains month, activeDevs, totalPrs, totalCommits, prsPerDev, commitsPerDev fields');
});

// ── division by zero guard ────────────────────────────────────────────────────

describe('division by zero guard', () => {
  /**
   * When activeDevs = 0 (all authors are bots, or no activity), prsPerDev and
   * commitsPerDev must be null — not NaN, Infinity, or 0.
   */
  test.todo('activeDevs=0 returns null for prsPerDev (not NaN or Infinity)');
  test.todo('activeDevs=0 returns null for commitsPerDev (not NaN or Infinity)');
});
