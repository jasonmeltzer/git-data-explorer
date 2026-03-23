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
  type: 'repo_start' | 'page_complete' | 'repo_complete' | 'rate_limit' | 'secondary_rate_limit' | 'error' | 'batch_complete';
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
}

// Settings (bot toggle + collection depth)
export interface AppSettings {
  includeBots: boolean;
  depthMonths: number;
}
