import fs from 'node:fs';
import path from 'node:path';

const ENV_PATH = path.join(process.cwd(), '.env');

/**
 * Read the current GITHUB_TOKEN from the .env file (not process.env cache).
 * Returns null if .env doesn't exist or GITHUB_TOKEN is empty.
 */
export function readToken(): string | null {
  if (!fs.existsSync(ENV_PATH)) return null;
  const content = fs.readFileSync(ENV_PATH, 'utf-8');
  const match = content.match(/^GITHUB_TOKEN=(.+)$/m);
  if (!match || !match[1] || match[1].trim() === '') return null;
  return match[1].trim();
}

/**
 * Mask a token for display. Per D-05: show first 4 chars + "****" + last 4 chars.
 * e.g., "ghp_****...a3b2"
 */
export function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return token.slice(0, 4) + '****...' + token.slice(-4);
}

/**
 * Get current token status for the GET /api/settings/token endpoint.
 */
export function getTokenStatus(): { configured: boolean; maskedToken: string | null } {
  const token = readToken();
  if (!token) return { configured: false, maskedToken: null };
  return { configured: true, maskedToken: maskToken(token) };
}

/**
 * Validate a GitHub PAT against the GitHub API (per D-04).
 * Returns { valid, login, scopes, error } — validates before writing.
 */
export async function validateGitHubToken(token: string): Promise<{
  valid: boolean;
  login?: string;
  scopes?: string[];
  error?: string;
}> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      if (res.status === 401) return { valid: false, error: 'Invalid token — GitHub returned 401 Unauthorized' };
      return { valid: false, error: `GitHub API returned ${res.status}: ${res.statusText}` };
    }

    const scopeHeader = res.headers.get('x-oauth-scopes') ?? '';
    const scopes = scopeHeader.split(',').map(s => s.trim()).filter(Boolean);
    const data = await res.json() as { login: string };

    return { valid: true, login: data.login, scopes };
  } catch (err) {
    return { valid: false, error: `Failed to reach GitHub API: ${(err as Error).message}` };
  }
}

/**
 * Validate a token against GitHub API and, if valid, write it to .env file.
 * Per D-04: validate BEFORE writing. Returns success/error response.
 */
export async function validateAndSaveToken(token: string): Promise<{
  success: boolean;
  error?: string;
  maskedToken?: string;
  scopes?: string[];
  login?: string;
}> {
  // Validate against GitHub first (per D-04)
  const validation = await validateGitHubToken(token);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  // Write to .env file
  writeTokenToEnv(token);

  // Note: process.env.GITHUB_TOKEN is already set by dotenv on startup.
  // readToken() reads from .env file directly, so no env assignment needed here.

  return {
    success: true,
    maskedToken: maskToken(token),
    scopes: validation.scopes,
    login: validation.login,
  };
}

/**
 * Write GITHUB_TOKEN to .env file. Creates .env if it doesn't exist.
 * Preserves other env vars if .env already has content.
 */
function writeTokenToEnv(token: string): void {
  let content = '';
  if (fs.existsSync(ENV_PATH)) {
    content = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  if (content.match(/^GITHUB_TOKEN=.*$/m)) {
    // Replace existing GITHUB_TOKEN line
    content = content.replace(/^GITHUB_TOKEN=.*$/m, `GITHUB_TOKEN=${token}`);
  } else {
    // Append GITHUB_TOKEN
    if (content && !content.endsWith('\n')) content += '\n';
    content += `GITHUB_TOKEN=${token}\n`;
  }

  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}
