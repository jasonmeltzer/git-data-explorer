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
