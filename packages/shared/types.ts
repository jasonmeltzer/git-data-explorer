// API response shapes shared between server and client

export interface HealthResponse {
  status: 'ok' | 'error';
  db: string;
  timestamp: string;
}

export interface TokenStatus {
  configured: boolean;
  maskedToken: string | null; // e.g., "ghp_****...a3b2" or null if not set
  scopes: string[] | null;   // GitHub token scopes if validated
}

export interface TokenSaveRequest {
  token: string;
}

export interface TokenSaveResponse {
  success: boolean;
  error?: string;
  maskedToken?: string;
  scopes?: string[];
}

// GitHub repo as returned by /api/repos/available
export interface GitHubRepo {
  githubId: number;
  fullName: string;    // "owner/repo-name"
  name: string;        // "repo-name"
  ownerLogin: string;  // "owner"
  isPrivate: boolean;
  defaultBranch: string;
  repoCreatedAt?: string;  // ISO timestamp — GitHub repo creation date
}

// Response from GET /api/repos/available
export interface AvailableReposResponse {
  repos: GitHubRepo[];
  authenticatedLogin: string;
}

// Tracked repo as stored in SQLite (returned by GET /api/repos)
export interface TrackedRepo {
  id: number;
  githubId: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  isPrivate: boolean;
  defaultBranch: string;
  addedAt: string;     // ISO timestamp
  removedAt: string | null;
}

// Response from GET /api/repos/:id/delete-preview
export interface RepoDeleteCounts {
  commits: number;
  prs: number;
}

// Collection status for a single resource (commits or PRs) within a repo
export type CollectionResourceStatus = 'pending' | 'in_progress' | 'complete' | 'paused' | 'error';

// Overall repo collection status (derived from its resource statuses)
export type CollectionRepoOverallStatus = 'pending' | 'collecting' | 'updating' | 'complete' | 'paused' | 'error';

// Per-repo collection status as returned by the API
export interface CollectionRepoStatus {
  repoId: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  status: CollectionRepoOverallStatus;
  commitsCollected: number;
  prsCollected: number;
  lastSyncedAt: string | null;   // ISO timestamp
  errorMessage: string | null;
  isFirstSync: boolean;          // true if never completed before
  monthsCollected: number | null; // how many months of data collected for this repo
  depthMonths: number;            // current global depth setting
}

// SSE progress event shape
export interface CollectionProgressEvent {
  type: 'repo_start' | 'page_complete' | 'repo_complete' | 'rate_limit' | 'secondary_rate_limit' | 'error' | 'batch_complete' | 'status_snapshot';
  repoId: number;
  repoFullName: string;
  resourceType?: 'commits' | 'pull_requests';
  itemsInPage?: number;
  totalItemsSoFar?: number;
  rateLimitResetAt?: string;     // ISO timestamp for rate-limit reset
  rateLimitRemaining?: number;
  rateLimitTotal?: number;
  errorMessage?: string;
  reposCompleted?: number;
  reposTotal?: number;
}

// Overall collection batch status
export interface CollectionBatchStatus {
  isActive: boolean;
  repoStatuses: CollectionRepoStatus[];
  rateLimitRemaining: number | null;
  rateLimitTotal: number | null;
  rateLimitResetAt: string | null;
  botsExcludedCount: number;
  depthMonths: number;  // global depth setting
  maxDepthMonths: number; // max meaningful depth based on oldest tracked repo
}

// Settings (bot toggle + collection depth)
export interface AppSettings {
  includeBots: boolean;
  depthMonths: number;
}

// --- Analytics Types (Phase 4) ---

export type TenureMode = 'global' | 'repo';
export type CohortLabel = string; // Derived from cohort-config — see src/shared/cohort-config.ts
export type PeriodLabel = 'before' | 'after' | 'all';

export interface CohortMetricsRow {
  cohort: CohortLabel;
  period: PeriodLabel;
  periodMonth: string;         // ISO month 'YYYY-MM'
  avgLinesAdded: number;
  avgLinesDeleted: number;
  avgFilesChanged: number;
  totalCount: number;          // number of commits or PRs
  contributorCount: number;    // distinct authors in this bucket
}

export interface CohortMetricsParams {
  startDate: Date;
  endDate: Date;
  tenureMode: TenureMode;
  repoIds?: number[];          // filter to specific repos (empty = all complete repos)
  aiMarkerDate?: Date | null;  // from app_config; null = no split
}

export interface AiMarkerConfig {
  date: Date | null;
}

export interface RampUpBucket {
  weekIndex: number;           // 0-11 (first 12 weeks after first commit)
  avgLinesChanged: number;     // avg (linesAdded + linesDeleted) per commit in this bucket
  avgFilesChanged: number;     // avg files changed per commit in this bucket
  contributionCount: number;   // total commits in this week bucket
  contributorCount: number;    // distinct authors contributing in this bucket
  joinPeriod: string;          // e.g., '2025-Q1', '2025-H1', '2025' — groups authors by when they joined
}

export interface RampUpParams {
  tenureMode: TenureMode;
  repoIds?: number[];
  joinPeriodGranularity: 'quarter' | 'half' | 'year';
}

// --- Rolling Window Comparison Types (Phase 4 Plan 03) ---

export type RollingGranularity = 'month' | 'quarter';

export interface RollingPeriod {
  label: string;               // e.g., 'Mar 2026', 'Q1 2026'
  startDate: Date;
  endDate: Date;
}

export interface RollingComparisonResult {
  granularity: RollingGranularity;
  current: RollingPeriodMetrics;
  prior: RollingPeriodMetrics;
  changes: RollingPeriodChanges;
}

export interface RollingPeriodMetrics {
  label: string;
  startDate: string;           // ISO
  endDate: string;             // ISO
  avgCommitSize: number;       // avg (linesAdded + linesDeleted) per commit
  avgPrSize: number;           // avg (linesAdded + linesDeleted) per PR
  commitCount: number;
  prCount: number;
  avgFilesPerCommit: number;
  avgFilesPerPr: number;
  dailyAvgCommitSize: number;  // normalized for partial period comparison
  dailyAvgPrSize: number;
  dailyCommitCount: number;
  dailyPrCount: number;
}

export interface RollingPeriodChanges {
  commitSize: number | null;   // percentage change, null if prior=0
  prSize: number | null;
  commitFrequency: number | null;
  prFrequency: number | null;
}

export interface RollingComparisonParams {
  granularity: RollingGranularity;
  referenceDate?: Date;        // defaults to now; allows testing
  tenureMode?: TenureMode;     // optional cohort filter
  cohort?: CohortLabel;        // optional: filter to a specific cohort
  repoIds?: number[];
}

// --- Contributor Stats (Phase 5) ---

export interface ContributorStats {
  authorLogin: string;
  cohort: CohortLabel;
  totalCommits: number;
  totalPrs: number;
  avgLinesAdded: number;
  avgLinesDeleted: number;
  avgFilesChanged: number;
  firstCommitAt: string;  // ISO timestamp
}

export interface ContributorBeforeAfterStats {
  authorLogin: string;
  cohort: CohortLabel;
  firstCommitAt: string;
  pre: ContributorStats | null;
  post: ContributorStats | null;
}

export interface ContributorRepoStats extends ContributorStats {
  repoId: number;
  repoFullName: string;
  firstCommitInRepoAt: string;  // ISO timestamp — MIN(committed_at) for this author in this repo
}

export interface ContributorRepoBeforeAfterStats {
  authorLogin: string;
  repoId: number;
  repoFullName: string;
  cohort: CohortLabel;
  firstCommitInRepoAt: string;
  firstCommitAt: string;
  pre: ContributorRepoStats | null;
  post: ContributorRepoStats | null;
}

// ─── Phase 9.4: Team Distribution types ─────────────────────────────────────

export interface Period {
  startDate: string;   // ISO date string
  endDate: string;     // ISO date string
  label: string;
  markerDate?: string; // ISO date string, for chart marker decoration
}

export interface PeriodMetric {
  period: Period;
  metrics: Record<string, number | null>;
}

export type ConcentrationBasis = 'prs' | 'commits' | 'lines';

export interface ConcentrationMonthlyRow {
  month: string;           // 'YYYY-MM'
  basis: ConcentrationBasis;
  top1Share: number | null;  // 0-100 (percentage), null if zero activity for this basis
  top3Share: number | null;
  top5Share: number | null;
  hhi: number | null;        // 0-1 scale
  gini: number | null;       // 0-1 scale
  busFactor: number | null;  // devsToReach50Pct, integer
  activeDevs: number;        // always populated (commit-OR-PR definition)
  topContributor: string | null; // github_login of top-1 contributor for chart annotation
}

export interface HeadcountMonthlyRow {
  month: string;              // 'YYYY-MM'
  activeDevs: number;         // commit-OR-PR active definition (D-09)
  totalPrs: number;
  totalCommits: number;
  prsPerDev: number | null;   // null if activeDevs=0
  commitsPerDev: number | null;
}

/**
 * Per-month PR turnaround (cycle-time) row (Phase 9.6).
 *
 * Cycle time = `mergedAt - firstCommitAt` (D-04/D-05) — first-commit-to-merge,
 * NOT open-to-merge. PRs without `firstCommitAt` are excluded from medians but
 * counted in `totalPrCount` so the chart can surface a coverage caveat (D-06).
 *
 * `medianHoursToMerge` is a TRUE median computed via TypeScript post-processing
 * (SQLite has no MEDIAN()). `avgHoursToMerge` is a real mean from the same
 * filtered set. Shape locked by D-07 — synchronized with `export-types.ts` and
 * `hooks/usePrTurnaround.ts`.
 */
export interface PrTurnaroundRow {
  periodMonth: string;            // 'YYYY-MM'
  medianHoursToMerge: number;     // TRUE median via TypeScript post-processing
  avgHoursToMerge: number;        // real mean (unchanged formula, from filtered set)
  prCount: number;                // covered PRs only — feeds the medians
  totalPrCount: number;           // total PRs in period including excluded — feeds coverage caveat
}

/**
 * Per-developer monthly time series row (Phase 9.5).
 *
 * One row per active dev per month across the analysis window. prCount and
 * commitCount = 0 for inactive months. Per-commit size signals (lines/files)
 * are null when commitCount = 0 — distinguishes "no activity" from "tiny
 * commits" (D-19). Bots excluded via authors.is_bot = 0 (D-23).
 *
 * Sort order: by (authorLogin, month) ascending so consumers can chunk by
 * author easily.
 *
 * Lines = additions + deletions per commit (total churn), not net (D-18).
 * Median computed via TypeScript post-processing — SQLite has no MEDIAN().
 */
export interface DeveloperMonthlyRow {
  authorLogin: string;            // raw login in main app, animal name post-anonymizer
  month: string;                  // 'YYYY-MM' UTC
  prCount: number;                // PRs created in month (created_at month basis, D-12)
  commitCount: number;            // non-bot commits authored in month
  meanLinesPerCommit: number | null;     // null when commitCount = 0
  medianLinesPerCommit: number | null;   // null when commitCount = 0
  meanFilesPerCommit: number | null;     // null when commitCount = 0
  medianFilesPerCommit: number | null;   // null when commitCount = 0
}
