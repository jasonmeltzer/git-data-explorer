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
export type CohortLabel = '0-3mo' | '3-12mo' | '1yr+';
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
