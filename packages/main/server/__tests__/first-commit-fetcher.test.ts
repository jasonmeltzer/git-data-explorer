import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLastPageFromLinkHeader } from '../services/first-commit-fetcher.js';

// ---------------------------------------------------------------------------
// Unit tests for getLastPageFromLinkHeader (pure function — no mocking needed)
// ---------------------------------------------------------------------------

describe('getLastPageFromLinkHeader', () => {
  it('returns null for undefined input', () => {
    expect(getLastPageFromLinkHeader(undefined)).toBeNull();
  });

  it('returns null for header without rel="last"', () => {
    const header = '<https://api.github.com/repos/o/r/commits?per_page=1&page=2>; rel="next"';
    expect(getLastPageFromLinkHeader(header)).toBeNull();
  });

  it('extracts page number from valid Link header with rel="last"', () => {
    const header =
      '<https://api.github.com/repos/o/r/commits?author=x&per_page=1&page=42>; rel="last"';
    expect(getLastPageFromLinkHeader(header)).toBe(42);
  });

  it('returns null for header with non-numeric page param', () => {
    const header =
      '<https://api.github.com/repos/o/r/commits?author=x&per_page=1&page=abc>; rel="last"';
    expect(getLastPageFromLinkHeader(header)).toBeNull();
  });

  it('extracts page number when multiple rel entries are present', () => {
    const header =
      '<https://api.github.com/repos/o/r/commits?page=2>; rel="next", ' +
      '<https://api.github.com/repos/o/r/commits?page=99>; rel="last"';
    expect(getLastPageFromLinkHeader(header)).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Tests for fetchAuthorFirstCommit (requires mock Octokit)
// ---------------------------------------------------------------------------

// We import fetchAuthorFirstCommit after vi.mock so the module factory can
// inject a test-double for createOctokit.

vi.mock('../services/octokit.js', () => ({
  createOctokit: vi.fn(),
}));

// Dynamic import after vi.mock is set up
const { fetchAuthorFirstCommit } = await import('../services/first-commit-fetcher.js');
const { createOctokit } = await import('../services/octokit.js');

describe('fetchAuthorFirstCommit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when octokit argument is null', async () => {
    const result = await fetchAuthorFirstCommit(null, 'owner', 'repo', 'alice');
    expect(result).toBeNull();
  });

  it('returns null when API returns empty data array', async () => {
    const mockOctokit = {
      request: vi.fn().mockResolvedValue({ data: [], headers: {} }),
    };
    (createOctokit as ReturnType<typeof vi.fn>).mockReturnValue(mockOctokit);

    const result = await fetchAuthorFirstCommit(mockOctokit as never, 'owner', 'repo', 'alice');
    expect(result).toBeNull();
  });

  it('returns date from first response when only one page exists', async () => {
    const mockOctokit = {
      request: vi.fn().mockResolvedValue({
        data: [{ commit: { author: { date: '2020-03-15T12:00:00Z' } } }],
        headers: {},
      }),
    };

    const result = await fetchAuthorFirstCommit(mockOctokit as never, 'owner', 'repo', 'alice');
    expect(result).toBeInstanceOf(Date);
    expect(result?.toISOString()).toBe('2020-03-15T12:00:00.000Z');
  });

  it('fetches last page when Link header indicates multiple pages', async () => {
    const linkHeader =
      '<https://api.github.com/repos/owner/repo/commits?author=alice&per_page=1&page=5>; rel="last"';

    const mockOctokit = {
      request: vi
        .fn()
        // First call: per_page=1, page not set → returns link header with 5 pages
        .mockResolvedValueOnce({
          data: [{ commit: { author: { date: '2023-10-01T00:00:00Z' } } }],
          headers: { link: linkHeader },
        })
        // Second call: page=5 → returns oldest commit
        .mockResolvedValueOnce({
          data: [{ commit: { author: { date: '2019-06-01T00:00:00Z' } } }],
          headers: {},
        }),
    };

    const result = await fetchAuthorFirstCommit(mockOctokit as never, 'owner', 'repo', 'alice');
    expect(result).toBeInstanceOf(Date);
    expect(result?.getFullYear()).toBe(2019);
    expect(mockOctokit.request).toHaveBeenCalledTimes(2);
  });
});
