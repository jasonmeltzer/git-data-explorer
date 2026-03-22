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
