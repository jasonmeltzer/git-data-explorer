/**
 * Synthetic seed data generator for Git Data Explorer.
 *
 * Creates data/seed.db with 3 repos, 34 contributors (3 bots + 31 humans),
 * 5000-10000 commits, and 500-1000 PRs spanning 13 months ending ~2 weeks ago.
 *
 * Run with: npx tsx scripts/seed.ts
 * Or:       npm run seed
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from '../server/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------

const SEED_DB_PATH = path.join(process.cwd(), 'data', 'seed.db');

// Ensure data directory exists
const dataDir = path.dirname(SEED_DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Idempotent: wipe existing seed.db and recreate from scratch
if (fs.existsSync(SEED_DB_PATH)) {
  fs.unlinkSync(SEED_DB_PATH);
  // Also remove WAL and SHM files if they exist
  const walPath = SEED_DB_PATH + '-wal';
  const shmPath = SEED_DB_PATH + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
}

console.log('Creating seed database at', SEED_DB_PATH);

const sqlite = new Database(SEED_DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const db = drizzle(sqlite, { schema });

// Run migrations to create schema
const migrationsFolder = path.join(process.cwd(), 'drizzle', 'migrations');
migrate(db, { migrationsFolder });

// ---------------------------------------------------------------------------
// Statistical distribution functions
// ---------------------------------------------------------------------------

/**
 * Box-Muller transform to generate log-normal random values.
 * Returns a minimum of 1 to avoid zero values for lines/files.
 */
function logNormal(mu: number, sigma: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  // Avoid log(0) — use 1e-10 as floor
  const safeU1 = Math.max(u1, 1e-10);
  const z = Math.sqrt(-2 * Math.log(safeU1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, Math.round(Math.exp(mu + sigma * z)));
}

// ---------------------------------------------------------------------------
// Weekday-weighted timestamp generation
// ---------------------------------------------------------------------------

// Day weights: Sun=0.04, Mon=0.20, Tue=0.20, Wed=0.20, Thu=0.20, Fri=0.12, Sat=0.04
const DAY_WEIGHTS = [0.04, 0.20, 0.20, 0.20, 0.20, 0.12, 0.04];
const MAX_DAY_WEIGHT = 0.20;

/**
 * Returns a random Date between windowStart and windowEnd, weighted toward
 * weekdays and away from the Dec 20 – Jan 3 holiday window.
 */
function weightedRandomDate(windowStart: Date, windowEnd: Date): Date {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const rangeMs = endMs - startMs;

  for (let attempt = 0; attempt < 1000; attempt++) {
    const candidateMs = startMs + Math.random() * rangeMs;
    const candidate = new Date(candidateMs);
    const dayOfWeek = candidate.getUTCDay();

    // Weekday-weight acceptance test
    const weight = DAY_WEIGHTS[dayOfWeek];
    if (Math.random() > weight / MAX_DAY_WEIGHT) {
      continue;
    }

    // Reject Dec 20–Jan 3 holiday window
    const month = candidate.getUTCMonth(); // 0-indexed
    const day = candidate.getUTCDate();
    const isHoliday = (month === 11 && day >= 20) || (month === 0 && day <= 3);
    if (isHoliday) {
      continue;
    }

    // Add realistic work-hours offset (8–20 UTC)
    const hours = 8 + Math.floor(Math.random() * 12);
    const minutes = Math.floor(Math.random() * 60);
    const seconds = Math.floor(Math.random() * 60);
    candidate.setUTCHours(hours, minutes, seconds, 0);

    return candidate;
  }

  // Fallback: return a simple random date without weighting
  const fallbackMs = startMs + Math.random() * rangeMs;
  return new Date(fallbackMs);
}

// ---------------------------------------------------------------------------
// Timeline constants
// ---------------------------------------------------------------------------

// Timeline is relative to "now" so default dashboard views (90d, 6mo) always have data.
// Data spans 13 months ending yesterday (UTC). AI marker at 6 months into the window.
const NOW = new Date();
const DATA_END = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() - 1, 23, 59, 59));
const DATA_START = new Date(DATA_END.getTime() - 13 * 30 * 24 * 60 * 60 * 1000); // ~13 months before end
DATA_START.setUTCDate(1); DATA_START.setUTCHours(0, 0, 0, 0); // snap to 1st of month
const AI_MARKER = new Date(DATA_START.getTime() + 6 * 30 * 24 * 60 * 60 * 1000); // ~6 months in
AI_MARKER.setUTCDate(1); AI_MARKER.setUTCHours(0, 0, 0, 0); // snap to 1st of month
const AI_RAMP_END = new Date(AI_MARKER.getTime() + 2 * 30 * 24 * 60 * 60 * 1000); // +2 months
AI_RAMP_END.setUTCDate(1); AI_RAMP_END.setUTCHours(0, 0, 0, 0);

const DATA_START_MS = DATA_START.getTime();
const DATA_END_MS = DATA_END.getTime();
const AI_MARKER_MS = AI_MARKER.getTime();
const AI_RAMP_END_MS = AI_RAMP_END.getTime();

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Repo definitions
// ---------------------------------------------------------------------------

const REPOS = [
  { githubId: 10001, fullName: 'acme-corp/platform', ownerLogin: 'acme-corp', name: 'platform', commitShare: 0.70 },
  { githubId: 10002, fullName: 'acme-corp/mobile-app', ownerLogin: 'acme-corp', name: 'mobile-app', commitShare: 0.20 },
  { githubId: 10003, fullName: 'acme-corp/data-pipeline', ownerLogin: 'acme-corp', name: 'data-pipeline', commitShare: 0.10 },
] as const;

// ---------------------------------------------------------------------------
// Contributor persona definitions
// ---------------------------------------------------------------------------

interface ContributorPersona {
  login: string;
  name: string;
  type:
    | 'senior'
    | 'regular'
    | 'new-pre-ai'
    | 'new-post-ai'
    | 'part-time'
    | 'bot'
    | 'commit-only'
    | 'pr-reviewer'
    // Phase 9.5 archetypes (D-21)
    | 'archetype-steady'
    | 'archetype-ai-power-user'
    | 'archetype-plateauing'
    | 'archetype-declining';
  repos: number[];         // indices into REPOS array
  joinWeekOffset: number;  // weeks from DATA_START when they first commit
  leaveWeekOffset?: number; // weeks from DATA_START when they stop committing (undefined = never)
  commitsPerWeek: number;
  sizeMu: number;
  sizeSigma: number;
  isBot: boolean;
  refactorWaveWeek?: number;  // If set, generate ~250 deletion-heavy commits in this week (relative to DATA_START)
  botStormWeeks?: [number, number];  // [startWeek, endWeek] — inclusive — bot commits are 14× normal during this window
  // Phase 9.5: optional delay (in months) for declining-variant archetype — drop happens N months after AI marker
  archetypeDelayMonths?: number;
}

const PERSONAS: ContributorPersona[] = [
  // --- 5 Seniors (all 3 repos) ---
  { login: 'jchen', name: 'Jessica Chen', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'mrodriguez', name: 'Miguel Rodriguez', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'akumar', name: 'Anika Kumar', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'sjohansson', name: 'Sofia Johansson', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'lwilson', name: 'Liam Wilson', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false, refactorWaveWeek: 40 },

  // --- 10 Regulars (some leave mid-way for realistic churn) ---
  { login: 'tgarcia', name: 'Tomás García', type: 'regular', repos: [0, 1], joinWeekOffset: 0, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'npatel', name: 'Neha Patel', type: 'regular', repos: [0, 1], joinWeekOffset: 2, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'eoconnor', name: 'Ethan O\'Connor', type: 'regular', repos: [0, 1], joinWeekOffset: 1, leaveWeekOffset: 30, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'ykim', name: 'Yuna Kim', type: 'regular', repos: [0, 1], joinWeekOffset: 3, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  // D-16 team-size decrease: btremblay moved from week 36 to week 31 (same month as eoconnor)
  // so both depart in the same ~2-month window, creating a visible step-down in activeDevs.
  { login: 'btremblay', name: 'Baptiste Tremblay', type: 'regular', repos: [0, 1], joinWeekOffset: 2, leaveWeekOffset: 31, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'fmartinez', name: 'Fernanda Martínez', type: 'regular', repos: [0], joinWeekOffset: 0, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rlee', name: 'Ryan Lee', type: 'regular', repos: [0], joinWeekOffset: 4, leaveWeekOffset: 40, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'kmoser', name: 'Katrin Moser', type: 'regular', repos: [0], joinWeekOffset: 1, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'dpark', name: 'Daniel Park', type: 'regular', repos: [1, 2], joinWeekOffset: 0, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'amüller', name: 'Anna Müller', type: 'regular', repos: [1, 2], joinWeekOffset: 3, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- D-16 Dominant contributor (active weeks 6-22: 3 full months at 45-55% top-1 share) ---
  // alexpower commits only in repo 0. The concentration query runs across ALL selected
  // repos (default view = all 3), so the denominator is monthly commits from every
  // persona in every repo, NOT just platform-repo activity. Accounting for:
  //   - 5 seniors × 3.57 cross-repo commits/week = ~72/mo
  //   - 5 regulars [0,1] × 5.14 commits/week ≈ 103/mo
  //   - 3 regulars [0] × 4.0 commits/week = 48/mo
  //   - 2 regulars [1,2] × 6.0 commits/week ≈ 48/mo
  //   - pre-AI new devs (mixed repos): ~50-60/mo
  //   - part-timer: ~2/mo
  //  → Other human commits ~325/month across all 3 repos.
  //
  // alex at 130 commits/week × 4.33 = ~563/mo:
  //   563 / (563 + 325 + ~108 Phase 9.5 archetype overhead) ≈ 56% — centered in D-16 target of 45-55%.
  //
  // Weeks 6-22 span from early month 2 to late month 5, ensuring months 3, 4, 5 are fully
  // covered and produce 3 consecutive dominant months. Verified by the seed.test.ts
  // dominant-contributor assertion after running `npm run seed`.
  //
  // Phase 9.5 calibration: bumped from 90 → 130 commits/wk to absorb the ~108 commits/mo of
  // pre-AI volume added by the 8 archetype-bearing personas (D-21). Without this bump, alex's
  // share drops to ~47% nominal and Poisson noise dips it below the 45% threshold.
  { login: 'alexpower', name: 'Alex Power', type: 'regular', repos: [0], joinWeekOffset: 6, leaveWeekOffset: 22, commitsPerWeek: 130, sizeMu: 4.5, sizeSigma: 0.8, isBot: false },

  // --- 5 Pre-AI new devs (join months 2-5 = weeks 4-20, some churn out) ---
  { login: 'rookie-alice', name: 'Alice Thornton', type: 'new-pre-ai', repos: [0], joinWeekOffset: 4, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-bob', name: 'Bob Nakamura', type: 'new-pre-ai', repos: [0], joinWeekOffset: 8, leaveWeekOffset: 28, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-charlie', name: 'Charlie Osei', type: 'new-pre-ai', repos: [1], joinWeekOffset: 12, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-diana', name: 'Diana Ferreira', type: 'new-pre-ai', repos: [0], joinWeekOffset: 16, leaveWeekOffset: 32, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-eli', name: 'Eli Rosenberg', type: 'new-pre-ai', repos: [2], joinWeekOffset: 20, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- 5 Post-AI new devs (D-16 team-size increase: first 3 join at weeks 30-33 = same ~2-month window) ---
  // D-16: at least one team-size increase event: 3 joiners in the same 2-month window.
  // newdev-carol (week 30), newdev-dave (week 31), newdev-eva (week 33) all join within 3 weeks
  // creating a visible step-up in the activeDevs time series.
  { login: 'newdev-carol', name: 'Carol Vasquez', type: 'new-post-ai', repos: [0], joinWeekOffset: 30, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-dave', name: 'Dave Steinberg', type: 'new-post-ai', repos: [0], joinWeekOffset: 31, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-eva', name: 'Eva Lindström', type: 'new-post-ai', repos: [1], joinWeekOffset: 33, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-frank', name: 'Frank Adeyemi', type: 'new-post-ai', repos: [0], joinWeekOffset: 42, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-grace', name: 'Grace Tanaka', type: 'new-post-ai', repos: [2], joinWeekOffset: 44, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- 3 Part-timers ---
  { login: 'contractor-pat', name: 'Pat Sullivan', type: 'part-time', repos: [0], joinWeekOffset: 0, commitsPerWeek: 0.5, sizeMu: 2.5, sizeSigma: 1.2, isBot: false },
  { login: 'contractor-sam', name: 'Sam Okonkwo', type: 'part-time', repos: [1], joinWeekOffset: 0, commitsPerWeek: 0.5, sizeMu: 2.5, sizeSigma: 1.2, isBot: false },
  { login: 'contractor-lee', name: 'Lee Hofmann', type: 'part-time', repos: [2], joinWeekOffset: 0, commitsPerWeek: 0.5, sizeMu: 2.5, sizeSigma: 1.2, isBot: false },

  // --- Commit-only persona (D-01: direct-to-main workflow, zero PRs) ---
  // Exercises the ScaryRealPanel zero-PR null guard and the divergence between
  // commits-basis activeDevs and PRs-basis activeDevs in concentration analytics.
  // joinWeekOffset: 24 — start AFTER alexpower's dominant window (weeks 6-22) ends so direct-devon's
  // cross-repo commits don't dilute alex's monthly commit share below the D-16 test's 45% threshold.
  // Devon still has ~28 weeks of activity (weeks 24-52) producing ~80 commits, more than enough for
  // the Phase 9.4.2 "commits > 0 AND 0 PRs" assertions.
  { login: 'direct-devon', name: 'Devon Quinn', type: 'commit-only', repos: [2], joinWeekOffset: 24, commitsPerWeek: 3, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- PR-reviewer persona (D-02: merges PRs but minimal own commits) ---
  // Exercises D-10 merged_at author-set semantics: has active PR months
  // where they authored 0 commits (extra PRs injected in injectPrReviewerPrs below).
  // commitsPerWeek is intentionally low (~1 commit/month on average).
  // repos: [0] (single repo) keeps total commits modest — expected total ≈ 0.3 × ~46 active
  // weeks × 1 repo ≈ 14 commits with Poisson variance ±5 — so monthly PR-without-commit windows
  // reliably occur.
  { login: 'reviewer-riley', name: 'Riley Navarro', type: 'pr-reviewer', repos: [0], joinWeekOffset: 10, commitsPerWeek: 0.3, sizeMu: 2.5, sizeSigma: 0.8, isBot: false },

  // --- 3 Bots (all 3 repos, KNOWN_BOTS set) ---
  { login: 'dependabot[bot]', name: 'Dependabot', type: 'bot', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 5, sizeMu: 1.0, sizeSigma: 0.3, isBot: true, botStormWeeks: [34, 37] },
  { login: 'github-actions[bot]', name: 'GitHub Actions', type: 'bot', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 5, sizeMu: 1.0, sizeSigma: 0.3, isBot: true },
  { login: 'renovate[bot]', name: 'Renovate Bot', type: 'bot', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 5, sizeMu: 1.0, sizeSigma: 0.3, isBot: true },

  // --- Phase 9.5 archetype personas (D-21) ---
  // 4 base archetypes + 4 variants = 8 archetype-bearing devs.
  // Distribution rationale: AI-power-users stay in repo 0 (the dominant 70%-share repo) because
  // they ARE the D-21 narrative anchor (post-AI ramp + lines/commit drop) and need to be visible
  // in default all-repos and repo-0 views. The other archetypes are distributed across repos 1
  // and 2 to avoid diluting alexpower's 45-55% commit-share dominance window in repo 0
  // (Plan 03's D-16 test). All archetypes still appear in default all-repos analytics views.

  // Steady base: ~3 PRs/mo throughout, no AI-marker shape change. Repo 1 (mobile-app).
  { login: 'arch-steady-stella', name: 'Stella Aurora', type: 'archetype-steady', repos: [1], joinWeekOffset: 0, commitsPerWeek: 3.0, sizeMu: 3.0, sizeSigma: 0.6, isBot: false },

  // Steady variant: same shape, lower volume baseline (~2 PRs/mo) — D-21 "base + variant" per archetype. Repo 2.
  { login: 'arch-steady-soren', name: 'Soren Aurora', type: 'archetype-steady', repos: [2], joinWeekOffset: 0, commitsPerWeek: 2.0, sizeMu: 3.0, sizeSigma: 0.6, isBot: false },

  // AI-power-user base: ~3 → ~8 PRs/mo post-AI, sustained. Lines/commit drops post-AI (D-21 narrative anchor). Repo 0.
  { login: 'arch-aipower-aiden', name: 'Aiden Powers', type: 'archetype-ai-power-user', repos: [0], joinWeekOffset: 0, commitsPerWeek: 3.0, sizeMu: 4.0, sizeSigma: 0.7, isBot: false },

  // AI-power-user variant: milder ramp (~3 → ~6 PRs/mo), smaller lines drop. Repo 0.
  { login: 'arch-aipower-anya', name: 'Anya Powers', type: 'archetype-ai-power-user', repos: [0], joinWeekOffset: 0, commitsPerWeek: 3.0, sizeMu: 3.5, sizeSigma: 0.7, isBot: false },

  // Plateauing: ~2 → ~6 PRs/mo by month +3, levels there for remainder. Repo 1.
  { login: 'arch-plateau-pat', name: 'Pat Plateau', type: 'archetype-plateauing', repos: [1], joinWeekOffset: 0, commitsPerWeek: 2.0, sizeMu: 3.0, sizeSigma: 0.6, isBot: false },

  // Plateauing variant: shorter plateau — levels by month +1. Repo 2.
  { login: 'arch-plateau-priya', name: 'Priya Plateau', type: 'archetype-plateauing', repos: [2], joinWeekOffset: 0, commitsPerWeek: 2.0, sizeMu: 3.0, sizeSigma: 0.6, isBot: false },

  // Declining: ~5 → ~2 PRs/mo post-AI, sustained low.
  // NOTE: assigned to repo 1 (mobile-app, not repo 0) because their pre-AI volume of 5/wk would
  // dilute alexpower's 45-55% commit-share dominance window (D-16 in Plan 03's seed.test.ts) when
  // committing to the same repo. Repo 1 keeps the archetype shape visible in the all-repos view.
  { login: 'arch-decline-dax', name: 'Dax Decliner', type: 'archetype-declining', repos: [1], joinWeekOffset: 0, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 0.6, isBot: false },

  // Declining variant: drop happens 3 months after AI marker (delayed change). Repo 2 for the same
  // D-16 preservation reason as the base persona above.
  { login: 'arch-decline-delia', name: 'Delia Decliner', type: 'archetype-declining', repos: [2], joinWeekOffset: 0, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 0.6, isBot: false, archetypeDelayMonths: 3 },
];

// ---------------------------------------------------------------------------
// Senior persona early-commit stagger config
// ---------------------------------------------------------------------------

/**
 * Maps senior persona logins to the repo indexes where they get tenure-anchor
 * commits (inserted 2-3 years before DATA_START so per-repo tenure >= 360 days).
 *
 * Stagger design (D-07 showcase scenario):
 *   jchen, mrodriguez, akumar  → Senior in platform (repo 0) only
 *   sjohansson                 → Senior in platform + mobile-app (repos 0, 1)
 *   lwilson                    → Senior in all 3 repos
 */
const SENIOR_EARLY_COMMIT_REPOS: Record<string, number[]> = {
  'jchen':      [0],       // Senior in platform only
  'mrodriguez': [0],       // Senior in platform only
  'akumar':     [0],       // Senior in platform only
  'sjohansson': [0, 1],   // Senior in platform + mobile-app
  'lwilson':    [0, 1, 2], // Senior in all 3 repos
};

// ---------------------------------------------------------------------------
// Commit message pools
// ---------------------------------------------------------------------------

const COMMIT_MESSAGES = [
  'feat: add user authentication',
  'fix: resolve null pointer in parser',
  'chore: update dependencies',
  'refactor: extract shared utility',
  'docs: update API reference',
  'test: add integration tests for auth module',
  'style: format code per linter rules',
  'perf: optimize database query',
  'feat: implement data export',
  'fix: correct timezone handling in date picker',
  'chore: bump eslint version',
  'refactor: simplify validation logic',
  'feat: add pagination support',
  'fix: handle empty state gracefully',
  'docs: add inline comments to complex functions',
  'test: increase coverage for edge cases',
  'perf: batch API requests',
  'fix: resolve race condition in event handler',
  'feat: add dark mode support',
  'chore: clean up unused imports',
  'refactor: split large component into smaller ones',
  'fix: prevent duplicate submissions',
  'feat: add search functionality',
  'test: mock external API calls in unit tests',
  'chore: configure CI pipeline',
  'fix: handle network timeout gracefully',
  'feat: add CSV export',
  'refactor: unify error handling across modules',
  'docs: update README with setup instructions',
  'perf: cache expensive computations',
];

const PR_TITLES = [
  'feat: implement user dashboard',
  'fix: handle edge case in date parsing',
  'chore: upgrade framework dependencies',
  'refactor: simplify authentication flow',
  'feat: add export functionality',
  'fix: correct timezone handling',
  'perf: batch database inserts',
  'feat: add search and filter to data table',
  'fix: resolve race condition on save',
  'chore: update CI configuration',
  'refactor: extract reusable components',
  'feat: implement CSV download',
  'fix: handle empty results gracefully',
  'docs: document new API endpoints',
  'test: add end-to-end tests for auth flow',
];

// ---------------------------------------------------------------------------
// Commit generation
// ---------------------------------------------------------------------------

interface CommitRecord {
  sha: string;
  repoIndex: number;
  authorLogin: string;
  message: string;
  committedAt: Date;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
}

let globalCommitCounter = 0;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Compute the AI ramp progress factor [0, 1] for a given commit date.
 * 0 = before AI marker, 1 = fully in AI era (after AI_RAMP_END).
 */
function aiRampProgress(date: Date): number {
  const ms = date.getTime();
  if (ms <= AI_MARKER_MS) return 0;
  if (ms >= AI_RAMP_END_MS) return 1;
  return (ms - AI_MARKER_MS) / (AI_RAMP_END_MS - AI_MARKER_MS);
}

/**
 * Phase 9.5: Plateau ramp progress — 0 before AI marker, ramps to 1 over `plateauMonths`,
 * then stays at 1. Used by archetype-plateauing.
 */
function plateauingRampProgress(date: Date, plateauMonths: number = 3): number {
  const ms = date.getTime();
  if (ms <= AI_MARKER_MS) return 0;
  const plateauEnd = AI_MARKER_MS + plateauMonths * 30 * 24 * 60 * 60 * 1000;
  if (ms >= plateauEnd) return 1;
  return (ms - AI_MARKER_MS) / (plateauEnd - AI_MARKER_MS);
}

/**
 * Phase 9.5: Delayed declining ramp progress — 0 until (AI_MARKER + delayMonths), then ramps
 * to 1 over the next 1 month. Used by archetype-declining with archetypeDelayMonths.
 */
function delayedDecliningRampProgress(date: Date, delayMonths: number = 0): number {
  const ms = date.getTime();
  const delayMs = delayMonths * 30 * 24 * 60 * 60 * 1000;
  const dropStart = AI_MARKER_MS + delayMs;
  const dropEnd = dropStart + 1 * 30 * 24 * 60 * 60 * 1000;  // 1-month drop window
  if (ms <= dropStart) return 0;
  if (ms >= dropEnd) return 1;
  return (ms - dropStart) / (dropEnd - dropStart);
}

/**
 * Generate commits for a single persona in a single repo.
 */
function generateCommitsForPersonaRepo(
  persona: ContributorPersona,
  repoIndex: number,
  allRepoCommitShares: number[]
): CommitRecord[] {
  const records: CommitRecord[] = [];

  // Compute join date
  const joinMs = DATA_START_MS + persona.joinWeekOffset * MS_PER_WEEK;
  if (joinMs >= DATA_END_MS) return records;

  const activeStart = new Date(Math.max(joinMs, DATA_START_MS));
  const leaveMs = persona.leaveWeekOffset != null
    ? DATA_START_MS + persona.leaveWeekOffset * MS_PER_WEEK
    : DATA_END_MS;
  const activeEndMs = Math.min(leaveMs, DATA_END_MS);

  // Adjust commit rate by repo share weighting
  const personaRepoShares = persona.repos.map(r => REPOS[r].commitShare);
  const maxShare = Math.max(...personaRepoShares);
  const thisRepoShare = REPOS[repoIndex].commitShare;
  const shareRatio = thisRepoShare / maxShare;
  const baseCommitsPerWeek = persona.commitsPerWeek * shareRatio;

  // Iterate week by week
  let weekStart = activeStart.getTime();

  while (weekStart < activeEndMs) {
    const weekEnd = Math.min(weekStart + MS_PER_WEEK, activeEndMs);
    const weekStartDate = new Date(weekStart);
    const weekEndDate = new Date(weekEnd);

    // Calculate week index since join (for ramp-up logic)
    const weeksSinceJoin = (weekStart - joinMs) / MS_PER_WEEK;

    // --- Refactor wave override ---
    // If this persona has a designated refactor-wave week AND we're in that specific week
    // (in the persona's first assigned repo only — to keep the deletion burst concentrated
    // in one repo), generate the wave instead of normal commits.
    const weeksSinceStart = (weekStart - DATA_START_MS) / MS_PER_WEEK;
    if (
      persona.refactorWaveWeek != null
      && Math.floor(weeksSinceStart) === persona.refactorWaveWeek
      && repoIndex === persona.repos[0]
    ) {
      const WAVE_COMMITS = 250;
      // W-2 round 4: empirical runs showed non-lwilson humans contribute ~30k lines in 2025-12 (well above
      // the plan's ~19k estimate), so 150/200 commits left lwilson at 69-69.2% — just under Plan 03's 70%
      // threshold. 250 commits × ~337 avg lines ≈ 84k lwilson lines; share ≈ 84 / (84 + 30) ≈ 74% with
      // comfortable margin above the 70% Plan 03 threshold.
      for (let c = 0; c < WAVE_COMMITS; c++) {
        const commitDate = weightedRandomDate(weekStartDate, weekEndDate);
        if (commitDate.getTime() >= activeEndMs) continue;

        // Deletion-heavy: large deletions, small additions, several files
        const linesDeleted = 250 + Math.floor(Math.random() * 150);  // 250-400
        const linesAdded = 5 + Math.floor(Math.random() * 15);        // 5-20
        const filesChanged = 3 + Math.floor(Math.random() * 5);       // 3-7

        globalCommitCounter++;
        records.push({
          sha: `seed-${globalCommitCounter}`,
          repoIndex,
          authorLogin: persona.login,
          message: 'refactor: consolidate legacy ' + pickRandom(['utilities', 'helpers', 'configs', 'types'] as const),
          committedAt: commitDate,
          linesAdded,
          linesDeleted,
          filesChanged,
        });
      }
      weekStart = weekEnd;
      continue;  // skip normal generation for this week
    }

    if (persona.type === 'bot') {
      // Bots: normally 1 commit per weekday (Mon-Fri); 14× during botStormWeeks.
      // W-3 round 2: empirical runs at 8× produced 49-52% bot share in 2025-11 — the
      // threshold margin was too thin (Plan 03 requires >= 50%, so 49.4% on jittery runs
      // caused flakes). 14× produces ~65% bot share with comfortable margin above 50%,
      // matching Plan 01 threat_model's original ~60-65% expectation. Human commit
      // volume in the storm-overlapping calendar month was higher than the plan estimated.
      const inStorm =
        persona.botStormWeeks != null
        && weeksSinceStart >= persona.botStormWeeks[0]
        && weeksSinceStart <= persona.botStormWeeks[1];
      const commitsPerWeekday = inStorm ? 14 : 1;

      for (let d = 0; d < 7; d++) {
        const dayMs = weekStart + d * MS_PER_DAY;
        if (dayMs >= DATA_END_MS) break;
        const dayDate = new Date(dayMs);
        const dow = dayDate.getUTCDay();
        if (dow >= 1 && dow <= 5) {
          // It's a weekday — add commitsPerWeekday commits
          for (let k = 0; k < commitsPerWeekday; k++) {
            const hours = 8 + Math.floor(Math.random() * 4);
            const minutes = Math.floor(Math.random() * 60);
            const seconds = Math.floor(Math.random() * 60);
            const commitDate = new Date(dayMs);
            commitDate.setUTCHours(hours, minutes, seconds, 0);

            globalCommitCounter++;
            records.push({
              sha: `seed-${globalCommitCounter}`,
              repoIndex,
              authorLogin: persona.login,
              message: pickRandom(COMMIT_MESSAGES),
              committedAt: commitDate,
              linesAdded: logNormal(persona.sizeMu, persona.sizeSigma),
              linesDeleted: 0,
              filesChanged: 1,
            });
          }
        }
      }
    } else {
      // Non-bot: Poisson-approximate commit count
      let currentMu = persona.sizeMu;
      let frequencyMultiplier = 1.0;

      const ramp = aiRampProgress(weekStartDate);

      if (
        persona.type === 'senior'
        || persona.type === 'regular'
        || persona.type === 'commit-only'
        || persona.type === 'pr-reviewer'
      ) {
        // After AI marker: more frequent, smaller commits
        frequencyMultiplier = 1.0 + 0.3 * ramp;
        currentMu = persona.sizeMu - 0.3 * ramp;
      } else if (persona.type === 'archetype-steady') {
        // D-21 steady: ~3 PRs/mo throughout, no AI shape change
        frequencyMultiplier = 1.0;
        // currentMu unchanged
      } else if (persona.type === 'archetype-ai-power-user') {
        // D-21 AI-power-user: ramps to ~8 PRs/mo (variant ~6) post-AI; lines/commit drops
        // Base (sizeMu=4.0) ramps 3→8 (2.67x); variant (sizeMu=3.5) ramps 3→6 (2.0x)
        const peakMultiplier = persona.sizeMu >= 4.0 ? 2.67 : 2.0;
        frequencyMultiplier = 1.0 + (peakMultiplier - 1.0) * ramp;
        // STRONGER lines drop than standard (-0.5 vs -0.3) — D-21 narrative anchor
        currentMu = persona.sizeMu - 0.5 * ramp;
      } else if (persona.type === 'archetype-plateauing') {
        // D-21 plateauing: ~2 → ~6 PRs/mo by month +3, levels after.
        // Variant ('priya') has shorter plateau (1 month).
        const plateauMonths = persona.login.includes('priya') ? 1 : 3;
        const plateauRamp = plateauingRampProgress(weekStartDate, plateauMonths);
        frequencyMultiplier = 1.0 + 2.0 * plateauRamp;  // 1.0 → 3.0 (i.e. 2 → 6 PRs/mo)
      } else if (persona.type === 'archetype-declining') {
        // D-21 declining: ~5 → ~2 PRs/mo post-AI, with optional 3-month delay (variant)
        const delayMonths = persona.archetypeDelayMonths ?? 0;
        const dropProgress = delayedDecliningRampProgress(weekStartDate, delayMonths);
        // Multiplier goes from 1.0 down to 0.4 (5×0.4 = 2)
        frequencyMultiplier = 1.0 - 0.6 * dropProgress;
      } else if (persona.type === 'new-pre-ai') {
        // 6-week ramp-up to target size
        const rampFraction = Math.min(1.0, weeksSinceJoin / 6);
        currentMu = 1.0 + (persona.sizeMu - 1.0) * rampFraction;
        // Also apply AI effects if past marker
        frequencyMultiplier = 1.0 + 0.3 * ramp;
        currentMu = currentMu - 0.2 * ramp;
      } else if (persona.type === 'new-post-ai') {
        // 3-week ramp-up to target size (faster ramp due to AI tools)
        const rampFraction = Math.min(1.0, weeksSinceJoin / 3);
        currentMu = 1.0 + (persona.sizeMu - 1.0) * rampFraction;
        frequencyMultiplier = 1.0 + 0.3 * ramp;
      } else if (persona.type === 'part-time') {
        // Part-timers don't significantly change with AI
        frequencyMultiplier = 1.0 + 0.1 * ramp;
      }

      // Ensure sizeMu doesn't go below a floor
      currentMu = Math.max(0.5, currentMu);

      const targetCommitsThisWeek = baseCommitsPerWeek * frequencyMultiplier;
      // Poisson-approximate: use (0.5 + random()) multiplier for variance
      const commitsThisWeek = Math.round(targetCommitsThisWeek * (0.5 + Math.random()));

      for (let c = 0; c < commitsThisWeek; c++) {
        if (weekStart >= activeEndMs) break;
        const commitDate = weightedRandomDate(weekStartDate, weekEndDate);
        if (commitDate.getTime() >= activeEndMs) continue;

        const linesAdded = logNormal(currentMu, persona.sizeSigma);
        const linesDeleted = Math.max(0, Math.round(linesAdded * (0.1 + Math.random() * 0.5)));
        const filesChanged = logNormal(1.5, 0.8);

        globalCommitCounter++;
        records.push({
          sha: `seed-${globalCommitCounter}`,
          repoIndex,
          authorLogin: persona.login,
          message: pickRandom(COMMIT_MESSAGES),
          committedAt: commitDate,
          linesAdded,
          linesDeleted,
          filesChanged,
        });
      }
    }

    weekStart = weekEnd;
  }

  return records;
}

// ---------------------------------------------------------------------------
// PR generation
// ---------------------------------------------------------------------------

interface PRRecord {
  githubId: number;
  repoIndex: number;
  authorLogin: string;
  number: number;
  title: string;
  state: string;
  createdAt: Date;
  mergedAt: Date | null;
  closedAt: Date | null;
  updatedAt: Date;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  commitCount: number;
  firstCommitAt: Date | null;  // Phase 9.6 D-15: first-commit-to-merge cycle time basis
}

/**
 * Phase 9.6 D-15: compute firstCommitAt per archetype.
 *
 * Archetype distribution (per D-15):
 *  - ~8%: null (coverage caveat exercise — pre-9.6 / fetch-failure simulation)
 *  - ~0.5%: rebase outlier (mergedAt - 91-180 days) — exceeds 90-day cap
 *  - ~1%: long-running branch (createdAt - 4-12 weeks) — NOT outlier
 *  - ~90.5%: typical pre/post-AI feature branch
 *    * pre-AI: createdAt - rand(8, 48)h
 *    * post-AI: createdAt - rand(1, 8)h
 *
 * The combination of:
 *  - PR turnaround distribution (createdAt → mergedAt; exp(2.5 + 1.2 * rand) hours)
 *  - firstCommitAt offset (above)
 * yields:
 *  - pre-AI median cycle (firstCommitAt → mergedAt) ≈ 24-36h
 *  - post-AI median cycle ≈ 4-8h (matches LDX3 narrative)
 *  - post/pre ratio < 0.5 (target ~70-80% reduction)
 */
function computeFirstCommitAt(
  createdAt: Date,
  mergedAt: Date | null,
  isPostAI: boolean,
  archetypeRandom: number,  // [0, 1) deterministic random for this PR
): Date | null {
  // ~8% null coverage (pre-9.6 / fetch-failure simulation — exercises D-06 caveat)
  if (archetypeRandom < 0.08) return null;

  // ~0.5% rebase outlier (mergedAt - 91-180 days) — exceeds 90-day cap, exercises D-08 exclusion
  if (archetypeRandom < 0.085 && mergedAt) {
    const daysOutlier = 91 + Math.floor(Math.random() * 90);  // 91-180 days
    return new Date(mergedAt.getTime() - daysOutlier * 86_400_000);
  }

  // ~1% long-running branch (createdAt - 4-12 weeks) — NOT outlier, exercises long-tail medians
  if (archetypeRandom < 0.095) {
    const weeks = 4 + Math.floor(Math.random() * 9);  // 4-12 weeks
    return new Date(createdAt.getTime() - weeks * 7 * 86_400_000);
  }

  // ~90.5% bulk: typical pre/post-AI feature branch
  const minH = isPostAI ? 1 : 8;
  const maxH = isPostAI ? 8 : 48;
  const hours = minH + Math.random() * (maxH - minH);
  return new Date(createdAt.getTime() - hours * 3_600_000);
}

let globalPRId = 100001;

function generatePRs(commitsByAuthorRepo: Map<string, CommitRecord[]>): PRRecord[] {
  const prs: PRRecord[] = [];
  const prNumberByRepo: Map<number, number> = new Map();

  for (const [key, commits] of commitsByAuthorRepo.entries()) {
    const repoIndex = parseInt(key.split(':')[0], 10);
    const authorLogin = key.split(':').slice(1).join(':');

    // Skip bots — they don't create PRs
    const persona = PERSONAS.find(p => p.login === authorLogin);
    if (persona?.isBot) continue;
    if (persona?.type === 'commit-only') continue;  // D-01: direct-to-main, no PRs

    // Sort commits by date
    const sorted = [...commits].sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime());

    // Create one PR per 8-12 commits
    let i = 0;
    while (i < sorted.length) {
      const batchSize = 8 + Math.floor(Math.random() * 5); // 8-12
      const batch = sorted.slice(i, i + batchSize);
      i += batchSize;

      if (batch.length === 0) continue;

      // PRs are typically opened after commits accumulate — use last commit date
      const lastCommitDate = batch[batch.length - 1].committedAt;
      const createdAt = lastCommitDate;

      // PR mergedAt = lastCommit + realistic review turnaround (log-normal distribution)
      // Phase 9.6 D-15: differentiate pre/post AI to achieve ~70-80% cycle-time reduction.
      // Pre-AI:  exp(2.5 + 1.2 * r)  ≈ 4-48h (matches legacy D-17 distribution)
      // Post-AI: exp(1.2 + 1.2 * r)  ≈ 1-12h (shorter review queues post-AI adoption)
      const isPostAIPr = lastCommitDate.getTime() >= AI_MARKER_MS;
      const baseLog = isPostAIPr ? 1.2 : 2.5;
      const turnaroundHours = Math.max(1, Math.round(Math.exp(baseLog + 1.2 * (Math.random() * 2 - 1))));
      const closeDaysMs = turnaroundHours * 60 * 60 * 1000;
      const closeDate = new Date(lastCommitDate.getTime() + closeDaysMs);

      // State distribution: 75% merged, 15% closed, 10% open
      const rand = Math.random();
      let state: string;
      let mergedAt: Date | null = null;
      let closedAt: Date | null = null;

      if (closeDate > DATA_END || rand < 0.10) {
        // Open PR (or PR that would close after data window)
        state = 'open';
        mergedAt = null;
        closedAt = null;
      } else if (rand < 0.25) {
        // Closed (not merged)
        state = 'closed';
        mergedAt = null;
        closedAt = closeDate;
      } else {
        // Merged
        state = 'merged';
        mergedAt = closeDate;
        closedAt = closeDate;
      }

      const updatedAt = closedAt ?? mergedAt ?? new Date(DATA_END_MS);

      // Aggregate commit sizes with slight variation
      const rawLinesAdded = batch.reduce((sum, c) => sum + c.linesAdded, 0);
      const rawLinesDeleted = batch.reduce((sum, c) => sum + c.linesDeleted, 0);
      const linesAdded = Math.round(rawLinesAdded * (0.8 + Math.random() * 0.4));
      const linesDeleted = Math.round(rawLinesDeleted * (0.8 + Math.random() * 0.4));
      const filesChanged = logNormal(1.5, 0.8);

      // Per-repo PR counter
      const prNum = (prNumberByRepo.get(repoIndex) ?? 0) + 1;
      prNumberByRepo.set(repoIndex, prNum);

      // Phase 9.6 D-15: compute firstCommitAt per archetype
      const isPostAI = createdAt.getTime() >= AI_MARKER_MS;
      const archetypeRandom = Math.random();
      const firstCommitAt = computeFirstCommitAt(createdAt, mergedAt, isPostAI, archetypeRandom);

      prs.push({
        githubId: globalPRId++,
        repoIndex,
        authorLogin,
        number: prNum,
        title: pickRandom(PR_TITLES),
        state,
        createdAt,
        mergedAt,
        closedAt,
        updatedAt,
        linesAdded,
        linesDeleted,
        filesChanged,
        commitCount: batch.length,
        firstCommitAt,
      });
    }
  }

  return prs;
}

/**
 * Inject extra PRs for the pr-reviewer persona (D-02).
 * These PRs span month boundaries: createdAt is mid-month, mergedAt is +14-21 days
 * (landing in the NEXT calendar month for most PRs). This exercises the D-10
 * merged_at author-set semantics path.
 *
 * Call AFTER generatePRs, BEFORE the PR batch insert, so authorIdByLogin is available.
 */
function injectPrReviewerPrs(existingPrs: PRRecord[]): PRRecord[] {
  const persona = PERSONAS.find(p => p.type === 'pr-reviewer');
  if (!persona) return existingPrs;

  // reviewer-riley is in repos: [0]
  const repoIndex = persona.repos[0];
  const prNumberByRepo = new Map<number, number>();
  // Seed the per-repo counter from existing PRs to avoid number collisions
  for (const pr of existingPrs) {
    const cur = prNumberByRepo.get(pr.repoIndex) ?? 0;
    if (pr.number > cur) prNumberByRepo.set(pr.repoIndex, pr.number);
  }

  const injected: PRRecord[] = [];

  // Active window: week 20 to week 48 from DATA_START (covers ~7 calendar months)
  const windowStartMs = DATA_START_MS + 20 * MS_PER_WEEK;
  const windowEndMs = DATA_START_MS + 48 * MS_PER_WEEK;

  // Iterate month-by-month through the window
  let monthCursor = new Date(windowStartMs);
  monthCursor.setUTCDate(1);
  monthCursor.setUTCHours(0, 0, 0, 0);

  while (monthCursor.getTime() < windowEndMs) {
    const monthStartMs = monthCursor.getTime();

    // Create 2-4 PRs per month
    const prCount = 2 + Math.floor(Math.random() * 3);

    for (let p = 0; p < prCount; p++) {
      // createdAt: days 10-25 of the month
      const dayOffset = 10 + Math.floor(Math.random() * 16); // 10..25
      const createdAt = new Date(monthStartMs);
      createdAt.setUTCDate(dayOffset);
      createdAt.setUTCHours(9 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);

      // mergedAt: createdAt + 14-21 days (crosses into next calendar month for most)
      const turnaroundDays = 14 + Math.floor(Math.random() * 8); // 14..21
      const mergedAt = new Date(createdAt.getTime() + turnaroundDays * MS_PER_DAY);

      // Skip if either date is past DATA_END (preserve month-boundary invariant)
      if (createdAt.getTime() >= DATA_END_MS) continue;
      if (mergedAt.getTime() > DATA_END_MS) continue;

      const linesAdded = logNormal(3.5, 0.5);
      const linesDeleted = Math.round(linesAdded * 0.3);
      const filesChanged = 2 + Math.floor(Math.random() * 4);

      const prNum = (prNumberByRepo.get(repoIndex) ?? 0) + 1;
      prNumberByRepo.set(repoIndex, prNum);

      // Phase 9.6 D-15: pr-reviewer PRs follow the same archetype mix as bulk PRs
      const isPostAI = createdAt.getTime() >= AI_MARKER_MS;
      const archetypeRandom = Math.random();
      const firstCommitAt = computeFirstCommitAt(createdAt, mergedAt, isPostAI, archetypeRandom);

      injected.push({
        githubId: globalPRId++,
        repoIndex,
        authorLogin: persona.login,
        number: prNum,
        title: pickRandom(PR_TITLES),
        state: 'merged',
        createdAt,
        mergedAt,
        closedAt: mergedAt,
        updatedAt: mergedAt,
        linesAdded,
        linesDeleted,
        filesChanged,
        commitCount: 1,
        firstCommitAt,
      });
    }

    // Advance to next month
    monthCursor.setUTCMonth(monthCursor.getUTCMonth() + 1);
  }

  console.log(`  Injected ${injected.length} PRs for pr-reviewer persona (reviewer-riley)`);
  return [...existingPrs, ...injected];
}

// ---------------------------------------------------------------------------
// Main seed execution
// ---------------------------------------------------------------------------

console.log('Generating synthetic data...');

// Step 1: Generate all commits
const allCommits: CommitRecord[] = [];
const commitsByAuthorRepo = new Map<string, CommitRecord[]>();

for (const persona of PERSONAS) {
  for (const repoIndex of persona.repos) {
    const repoCommitShares = REPOS.map(r => r.commitShare);
    const commits = generateCommitsForPersonaRepo(persona, repoIndex, repoCommitShares);

    allCommits.push(...commits);

    const key = `${repoIndex}:${persona.login}`;
    const existing = commitsByAuthorRepo.get(key) ?? [];
    commitsByAuthorRepo.set(key, [...existing, ...commits]);
  }
}

// Step 1b: Generate early tenure-anchor commits for senior personas
// These are inserted BEFORE DATA_START so they don't appear in analytics date range
// but they establish MIN(committed_at) per (author, repo) well past the 360-day threshold.
console.log('Generating early commits for senior persona tenure anchors...');

const EARLY_COMMIT_WINDOW_START_MS = DATA_START_MS - 3 * 365 * MS_PER_DAY; // 3 years before DATA_START
const EARLY_COMMIT_WINDOW_END_MS   = DATA_START_MS - 2 * 365 * MS_PER_DAY; // 2 years before DATA_START

const earlyCommits: CommitRecord[] = [];

for (const [login, repoIndexes] of Object.entries(SENIOR_EARLY_COMMIT_REPOS)) {
  for (const repoIndex of repoIndexes) {
    // 5-10 anchor commits per persona per repo, spread across the pre-window
    const count = 5 + Math.floor(Math.random() * 6); // 5–10
    for (let c = 0; c < count; c++) {
      // Evenly spread through the 1-year early window with some jitter
      const spread = (c / count) * (EARLY_COMMIT_WINDOW_END_MS - EARLY_COMMIT_WINDOW_START_MS);
      const jitter = Math.random() * (EARLY_COMMIT_WINDOW_END_MS - EARLY_COMMIT_WINDOW_START_MS) * 0.05;
      const committedAtMs = EARLY_COMMIT_WINDOW_START_MS + spread + jitter;
      const committedAt = new Date(committedAtMs);

      // Small anchor commits: 1-20 lines added, 0-5 deleted, 1-3 files
      const linesAdded = 1 + Math.floor(Math.random() * 20);
      const linesDeleted = Math.floor(Math.random() * 6);
      const filesChanged = 1 + Math.floor(Math.random() * 3);

      globalCommitCounter++;
      earlyCommits.push({
        sha: `seed-early-${globalCommitCounter}`,
        repoIndex,
        authorLogin: login,
        message: pickRandom(COMMIT_MESSAGES),
        committedAt,
        linesAdded,
        linesDeleted,
        filesChanged,
      });
    }
  }
}

console.log(`Inserting ${earlyCommits.length} early commits for senior persona tenure anchors...`);

// Merge early commits into allCommits (they'll be sorted below)
allCommits.push(...earlyCommits);

// Sort all commits by date for bulk insert
allCommits.sort((a, b) => a.committedAt.getTime() - b.committedAt.getTime());

console.log(`Generated ${allCommits.length} commits`);

// Step 2: Generate PRs (then inject pr-reviewer standalone PRs)
let allPRs = generatePRs(commitsByAuthorRepo);
allPRs = injectPrReviewerPrs(allPRs);
console.log(`Generated ${allPRs.length} PRs (including pr-reviewer injections)`);

// Step 3: Compute firstCommitAt per author
const firstCommitByAuthor = new Map<string, Date>();
for (const commit of allCommits) {
  const existing = firstCommitByAuthor.get(commit.authorLogin);
  if (!existing || commit.committedAt < existing) {
    firstCommitByAuthor.set(commit.authorLogin, commit.committedAt);
  }
}

// ---------------------------------------------------------------------------
// Database insertions
// ---------------------------------------------------------------------------

console.log('Inserting repositories...');

// 1. Insert repositories
const now = new Date();
const repoCreatedAt = new Date('2022-01-01T00:00:00Z');

for (const repo of REPOS) {
  db.insert(schema.repositories).values({
    githubId: repo.githubId,
    fullName: repo.fullName,
    ownerLogin: repo.ownerLogin,
    name: repo.name,
    isPrivate: false,
    defaultBranch: 'main',
    repoCreatedAt,
    addedAt: now,
  }).run();
}

// Retrieve inserted repo IDs
const insertedRepos = db.select().from(schema.repositories).all();
const repoIdByIndex = new Map<number, number>();
for (let i = 0; i < REPOS.length; i++) {
  const repo = insertedRepos.find(r => r.githubId === REPOS[i].githubId);
  if (repo) repoIdByIndex.set(i, repo.id);
}

console.log('Inserting authors...');

// 2. Insert authors
const uniqueAuthors = new Map<string, ContributorPersona>();
for (const persona of PERSONAS) {
  uniqueAuthors.set(persona.login, persona);
}

for (const [login, persona] of uniqueAuthors.entries()) {
  let firstCommit: Date;
  if (persona.type === 'new-pre-ai' || persona.type === 'new-post-ai') {
    // New devs: use their actual first commit in the data window
    firstCommit = firstCommitByAuthor.get(login) ?? DATA_START;
  } else {
    // Established devs (seniors, regulars, part-timers, bots): set firstCommitAt
    // well before DATA_START so they don't appear as "new developers" in ramp-up analysis.
    // Random date 1-3 years before DATA_START.
    const yearsBeforeMs = (1 + Math.random() * 2) * 365 * 24 * 60 * 60 * 1000;
    firstCommit = new Date(DATA_START.getTime() - yearsBeforeMs);
  }
  db.insert(schema.authors).values({
    githubLogin: login,
    name: persona.name,
    isBot: persona.isBot,
    firstCommitAt: firstCommit,
  }).run();
}

// Retrieve author IDs
const insertedAuthors = db.select().from(schema.authors).all();
const authorIdByLogin = new Map<string, number>();
for (const author of insertedAuthors) {
  authorIdByLogin.set(author.githubLogin, author.id);
}

console.log('Inserting commits in batches...');

// 3. Insert commits in batches of 500
const BATCH_SIZE = 500;
let commitInsertCount = 0;

for (let i = 0; i < allCommits.length; i += BATCH_SIZE) {
  const batch = allCommits.slice(i, i + BATCH_SIZE);
  const values = batch.map(c => ({
    sha: c.sha,
    repoId: repoIdByIndex.get(c.repoIndex)!,
    authorId: authorIdByLogin.get(c.authorLogin)!,
    message: c.message,
    committedAt: c.committedAt,
    linesAdded: c.linesAdded,
    linesDeleted: c.linesDeleted,
    filesChanged: c.filesChanged,
  }));

  db.insert(schema.commits).values(values).run();
  commitInsertCount += batch.length;

  if (commitInsertCount % 2000 === 0 || i + BATCH_SIZE >= allCommits.length) {
    process.stdout.write(`  ${commitInsertCount} / ${allCommits.length} commits\r`);
  }
}
process.stdout.write('\n');

console.log('Inserting PRs in batches...');

// 4. Insert PRs in batches of 500
let prInsertCount = 0;
for (let i = 0; i < allPRs.length; i += BATCH_SIZE) {
  const batch = allPRs.slice(i, i + BATCH_SIZE);
  const values = batch.map(pr => ({
    githubId: pr.githubId,
    repoId: repoIdByIndex.get(pr.repoIndex)!,
    authorId: authorIdByLogin.get(pr.authorLogin)!,
    number: pr.number,
    title: pr.title,
    state: pr.state,
    createdAt: pr.createdAt,
    mergedAt: pr.mergedAt,
    closedAt: pr.closedAt,
    updatedAt: pr.updatedAt,
    linesAdded: pr.linesAdded,
    linesDeleted: pr.linesDeleted,
    filesChanged: pr.filesChanged,
    commitCount: pr.commitCount,
    firstCommitAt: pr.firstCommitAt,  // Phase 9.6 D-15
  }));

  db.insert(schema.pullRequests).values(values).run();
  prInsertCount += batch.length;
}

console.log(`Inserted ${prInsertCount} PRs`);

// 5. Insert collection_state for each repo
console.log('Inserting collection state...');
for (let i = 0; i < REPOS.length; i++) {
  const repoId = repoIdByIndex.get(i)!;
  const depthTargetIso = DATA_START.toISOString();
  const oldestMonthIso = DATA_START.toISOString();

  for (const resourceType of ['commits', 'pull_requests'] as const) {
    db.insert(schema.collectionState).values({
      repoId,
      resourceType,
      status: 'complete',
      lastRunAt: now,
      direction: 'reverse',
      oldestMonthCollected: oldestMonthIso,
      depthTarget: depthTargetIso,
    }).run();
  }
}

// 6. Insert AI marker in app_config
console.log('Setting AI adoption marker...');
db.insert(schema.appConfig).values({
  key: 'ai_adoption_marker',
  value: AI_MARKER.toISOString(),
  updatedAt: now,
}).onConflictDoUpdate({
  target: schema.appConfig.key,
  set: {
    value: AI_MARKER.toISOString(),
    updatedAt: now,
  },
}).run();

// ---------------------------------------------------------------------------
// Senior persona per-repo tenure verification
// ---------------------------------------------------------------------------

console.log('\nSenior persona per-repo tenure check:');
const nowEpochSec = Math.floor(Date.now() / 1000);
const seniorCheckRows = sqlite.prepare(`
  SELECT a.github_login, r.full_name,
    MIN(CAST(c.committed_at AS INTEGER)) as earliest_commit,
    ? - MIN(CAST(c.committed_at AS INTEGER)) as tenure_seconds
  FROM commits c
  INNER JOIN authors a ON a.id = c.author_id
  INNER JOIN repositories r ON r.id = c.repo_id
  WHERE a.github_login IN ('jchen','mrodriguez','akumar','sjohansson','lwilson')
  GROUP BY a.id, c.repo_id
  ORDER BY a.github_login, r.full_name
`).all(nowEpochSec) as Array<{
  github_login: string;
  full_name: string;
  earliest_commit: number;
  tenure_seconds: number;
}>;

for (const row of seniorCheckRows) {
  const days = Math.floor(row.tenure_seconds / 86400);
  const cohort = days >= 360 ? 'SENIOR' : days >= 90 ? 'GROWING' : 'NEW';
  console.log(`  ${row.github_login} in ${row.full_name}: ${days} days (${cohort})`);
}

// ---------------------------------------------------------------------------
// Phase 9.4.2 scenario logs
// ---------------------------------------------------------------------------

console.log('\nPhase 9.4.2 scenarios:');
console.log('  Commit-only persona: direct-devon (commits, zero PRs)');
console.log('  PR-reviewer persona: reviewer-riley (many PRs, ~1 commit/month)');

const refactorWavePersona = PERSONAS.find(p => p.refactorWaveWeek != null);
if (refactorWavePersona) {
  const waveMonthIso = new Date(DATA_START_MS + refactorWavePersona.refactorWaveWeek! * MS_PER_WEEK).toISOString().slice(0, 10);
  console.log(`  Refactor wave: ${refactorWavePersona.login} in week ${refactorWavePersona.refactorWaveWeek} (approx ${waveMonthIso})`);
}

const botStormPersona = PERSONAS.find(p => p.botStormWeeks != null);
if (botStormPersona) {
  const [w0, w1] = botStormPersona.botStormWeeks!;
  const startIso = new Date(DATA_START_MS + w0 * MS_PER_WEEK).toISOString().slice(0, 10);
  const endIso   = new Date(DATA_START_MS + w1 * MS_PER_WEEK).toISOString().slice(0, 10);
  console.log(`  Bot storm: ${botStormPersona.login} weeks ${w0}-${w1} (${startIso} to ${endIso})`);
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------

const botCount = [...uniqueAuthors.values()].filter(p => p.isBot).length;
const contributorCount = uniqueAuthors.size;

console.log('\nSeed complete!');
console.log(`  Repos: ${REPOS.length}`);
console.log(`  Contributors: ${contributorCount} (${botCount} bots)`);
console.log(`  Commits: ${allCommits.length}`);
console.log(`  PRs: ${allPRs.length}`);
console.log(`  Date range: ${DATA_START.toISOString().slice(0, 10)} to ${DATA_END.toISOString().slice(0, 10)}`);
console.log(`  AI marker: ${AI_MARKER.toISOString().slice(0, 10)}`);
console.log(`  Database: ./data/seed.db`);
console.log('');
console.log('Run "npm run dev:seed" to start the app with seed data.');
