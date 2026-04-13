/**
 * Synthetic seed data generator for Git Data Explorer.
 *
 * Creates data/seed.db with 3 repos, ~30 contributors (including 3 bots),
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
  type: 'senior' | 'regular' | 'new-pre-ai' | 'new-post-ai' | 'part-time' | 'bot';
  repos: number[];         // indices into REPOS array
  joinWeekOffset: number;  // weeks from DATA_START when they first commit
  leaveWeekOffset?: number; // weeks from DATA_START when they stop committing (undefined = never)
  commitsPerWeek: number;
  sizeMu: number;
  sizeSigma: number;
  isBot: boolean;
}

const PERSONAS: ContributorPersona[] = [
  // --- 5 Seniors (all 3 repos) ---
  { login: 'jchen', name: 'Jessica Chen', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'mrodriguez', name: 'Miguel Rodriguez', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'akumar', name: 'Anika Kumar', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'sjohansson', name: 'Sofia Johansson', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },
  { login: 'lwilson', name: 'Liam Wilson', type: 'senior', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 2.5, sizeMu: 4.0, sizeSigma: 1.2, isBot: false },

  // --- 10 Regulars (some leave mid-way for realistic churn) ---
  { login: 'tgarcia', name: 'Tomás García', type: 'regular', repos: [0, 1], joinWeekOffset: 0, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'npatel', name: 'Neha Patel', type: 'regular', repos: [0, 1], joinWeekOffset: 2, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'eoconnor', name: 'Ethan O\'Connor', type: 'regular', repos: [0, 1], joinWeekOffset: 1, leaveWeekOffset: 30, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'ykim', name: 'Yuna Kim', type: 'regular', repos: [0, 1], joinWeekOffset: 3, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'btremblay', name: 'Baptiste Tremblay', type: 'regular', repos: [0, 1], joinWeekOffset: 2, leaveWeekOffset: 36, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'fmartinez', name: 'Fernanda Martínez', type: 'regular', repos: [0], joinWeekOffset: 0, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rlee', name: 'Ryan Lee', type: 'regular', repos: [0], joinWeekOffset: 4, leaveWeekOffset: 40, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'kmoser', name: 'Katrin Moser', type: 'regular', repos: [0], joinWeekOffset: 1, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'dpark', name: 'Daniel Park', type: 'regular', repos: [1, 2], joinWeekOffset: 0, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'amüller', name: 'Anna Müller', type: 'regular', repos: [1, 2], joinWeekOffset: 3, commitsPerWeek: 4.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- 5 Pre-AI new devs (join months 2-5 = weeks 4-20, some churn out) ---
  { login: 'rookie-alice', name: 'Alice Thornton', type: 'new-pre-ai', repos: [0], joinWeekOffset: 4, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-bob', name: 'Bob Nakamura', type: 'new-pre-ai', repos: [0], joinWeekOffset: 8, leaveWeekOffset: 28, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-charlie', name: 'Charlie Osei', type: 'new-pre-ai', repos: [1], joinWeekOffset: 12, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-diana', name: 'Diana Ferreira', type: 'new-pre-ai', repos: [0], joinWeekOffset: 16, leaveWeekOffset: 32, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'rookie-eli', name: 'Eli Rosenberg', type: 'new-pre-ai', repos: [2], joinWeekOffset: 20, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- 5 Post-AI new devs (join months 8-11 = weeks 30-44) ---
  { login: 'newdev-carol', name: 'Carol Vasquez', type: 'new-post-ai', repos: [0], joinWeekOffset: 30, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-dave', name: 'Dave Steinberg', type: 'new-post-ai', repos: [0], joinWeekOffset: 34, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-eva', name: 'Eva Lindström', type: 'new-post-ai', repos: [1], joinWeekOffset: 38, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-frank', name: 'Frank Adeyemi', type: 'new-post-ai', repos: [0], joinWeekOffset: 42, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },
  { login: 'newdev-grace', name: 'Grace Tanaka', type: 'new-post-ai', repos: [2], joinWeekOffset: 44, commitsPerWeek: 5.0, sizeMu: 3.0, sizeSigma: 1.0, isBot: false },

  // --- 3 Part-timers ---
  { login: 'contractor-pat', name: 'Pat Sullivan', type: 'part-time', repos: [0], joinWeekOffset: 0, commitsPerWeek: 0.5, sizeMu: 2.5, sizeSigma: 1.2, isBot: false },
  { login: 'contractor-sam', name: 'Sam Okonkwo', type: 'part-time', repos: [1], joinWeekOffset: 0, commitsPerWeek: 0.5, sizeMu: 2.5, sizeSigma: 1.2, isBot: false },
  { login: 'contractor-lee', name: 'Lee Hofmann', type: 'part-time', repos: [2], joinWeekOffset: 0, commitsPerWeek: 0.5, sizeMu: 2.5, sizeSigma: 1.2, isBot: false },

  // --- 3 Bots (all 3 repos, KNOWN_BOTS set) ---
  { login: 'dependabot[bot]', name: 'Dependabot', type: 'bot', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 5, sizeMu: 1.0, sizeSigma: 0.3, isBot: true },
  { login: 'github-actions[bot]', name: 'GitHub Actions', type: 'bot', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 5, sizeMu: 1.0, sizeSigma: 0.3, isBot: true },
  { login: 'renovate[bot]', name: 'Renovate Bot', type: 'bot', repos: [0, 1, 2], joinWeekOffset: 0, commitsPerWeek: 5, sizeMu: 1.0, sizeSigma: 0.3, isBot: true },
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

    if (persona.type === 'bot') {
      // Bots: 1 commit per weekday (Mon-Fri)
      for (let d = 0; d < 7; d++) {
        const dayMs = weekStart + d * MS_PER_DAY;
        if (dayMs >= DATA_END_MS) break;
        const dayDate = new Date(dayMs);
        const dow = dayDate.getUTCDay();
        if (dow >= 1 && dow <= 5) {
          // It's a weekday — add a commit
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
    } else {
      // Non-bot: Poisson-approximate commit count
      let currentMu = persona.sizeMu;
      let frequencyMultiplier = 1.0;

      const ramp = aiRampProgress(weekStartDate);

      if (persona.type === 'senior' || persona.type === 'regular') {
        // After AI marker: more frequent, smaller commits
        frequencyMultiplier = 1.0 + 0.3 * ramp;
        currentMu = persona.sizeMu - 0.3 * ramp;
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
      // Mostly 4-48 hours with a long tail up to ~7 days (Pitfall D-17)
      const turnaroundHours = Math.max(1, Math.round(Math.exp(2.5 + 1.2 * (Math.random() * 2 - 1))));
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
      });
    }
  }

  return prs;
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

// Step 2: Generate PRs
const allPRs = generatePRs(commitsByAuthorRepo);
console.log(`Generated ${allPRs.length} PRs`);

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
