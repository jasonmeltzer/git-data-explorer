import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { readToken } from './token.js';

// Create a ThrottledOctokit class with the throttling plugin applied once at module level
const ThrottledOctokit = Octokit.plugin(throttling);

/**
 * Create an Octokit client from the stored PAT.
 * Returns null if no token is configured.
 * MUST NOT cache — calls readToken() fresh each invocation so token changes take effect immediately.
 */
export function createOctokit(): InstanceType<typeof ThrottledOctokit> | null {
  const token = readToken();
  if (!token) return null;

  return new ThrottledOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, options: { method: string; url: string }, _octokit: unknown, retryCount: number) => {
        console.warn(
          `Rate limit hit for ${options.method} ${options.url} — waiting ${retryAfter}s (retry ${retryCount + 1})`
        );
        // Retry up to 2 times
        return retryCount < 2;
      },
      onSecondaryRateLimit: (retryAfter: number, options: { method: string; url: string }) => {
        // Secondary rate limit (concurrency/abuse) — do NOT retry (Phase 3 handles collection pacing)
        console.warn(
          `Secondary rate limit hit for ${options.method} ${options.url} — retryAfter ${retryAfter}s. Not retrying.`
        );
        // Return undefined (falsy) — no retry
      },
    },
  });
}
