import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the token service before importing octokit
vi.mock('../services/token.js', () => ({
  readToken: vi.fn(),
}));

describe('createOctokit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null when readToken returns null', async () => {
    const { readToken } = await import('../services/token.js');
    vi.mocked(readToken).mockReturnValue(null);

    const { createOctokit } = await import('../services/octokit.js');
    const result = createOctokit();
    expect(result).toBeNull();
  });

  it('returns an Octokit instance with .rest property when token exists', async () => {
    const { readToken } = await import('../services/token.js');
    vi.mocked(readToken).mockReturnValue('ghp_testtoken123456');

    const { createOctokit } = await import('../services/octokit.js');
    const result = createOctokit();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('rest');
  });
});
