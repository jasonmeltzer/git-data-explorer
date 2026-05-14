import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchPrFirstCommit } from '../services/pr-first-commit.js';

type MockResponse = { data: unknown; headers: Record<string, string | undefined> };

function makeMockOctokit(responses: MockResponse[]) {
  let callIdx = 0;
  return {
    request: vi.fn().mockImplementation(async () => {
      const r = responses[callIdx];
      callIdx += 1;
      if (!r) throw new Error('No more mock responses configured');
      return r;
    }),
  };
}

function commit(authoredIso: string | null, committedIso: string | null) {
  return {
    commit: {
      author: authoredIso ? { date: authoredIso } : null,
      committer: committedIso ? { date: committedIso } : null,
    },
  };
}

describe('fetchPrFirstCommit', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns null when octokit argument is null (D-03)', async () => {
    const result = await fetchPrFirstCommit(null, 'owner', 'repo', 42);
    expect(result).toBeNull();
  });

  it('returns null when API returns empty commits array (D-04 — 0-commit PR)', async () => {
    const mock = makeMockOctokit([{ data: [], headers: {} }]);
    const result = await fetchPrFirstCommit(mock as never, 'owner', 'repo', 42);
    expect(result).toBeNull();
  });

  it('returns the earliest MIN(authored, committed) across single-page commits (D-02)', async () => {
    const data = [
      commit('2025-03-01T10:00:00Z', '2025-03-05T10:00:00Z'), // MIN = 2025-03-01
      commit('2025-02-15T10:00:00Z', '2025-02-15T10:00:00Z'), // MIN = 2025-02-15 — earliest overall
      commit('2025-03-10T10:00:00Z', '2025-03-09T10:00:00Z'), // MIN = 2025-03-09
    ];
    const mock = makeMockOctokit([{ data, headers: {} }]);
    const result = await fetchPrFirstCommit(mock as never, 'owner', 'repo', 42);
    expect(result).toEqual(new Date('2025-02-15T10:00:00Z'));
  });

  it('iterates pages until Link header has no rel="next" (D-02)', async () => {
    const page1Data = [commit('2025-04-01T10:00:00Z', '2025-04-01T10:00:00Z')];
    const page2Data = [commit('2025-01-15T10:00:00Z', '2025-01-15T10:00:00Z')]; // earliest, on page 2
    const mock = makeMockOctokit([
      { data: page1Data, headers: { link: '<https://api.github.com/...&page=2>; rel="next"' } },
      { data: page2Data, headers: {} }, // no link header → end of pagination
    ]);
    const result = await fetchPrFirstCommit(mock as never, 'owner', 'repo', 42);
    expect(result).toEqual(new Date('2025-01-15T10:00:00Z'));
    expect(mock.request).toHaveBeenCalledTimes(2);
  });

  it('returns null when octokit.request rejects (D-03)', async () => {
    const mock = { request: vi.fn().mockRejectedValue(new Error('rate limit')) };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchPrFirstCommit(mock as never, 'owner', 'repo', 42);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('picks authoredDate when authored < committed (rebase preservation, D-02)', async () => {
    const data = [commit('2025-01-01T10:00:00Z', '2025-02-15T10:00:00Z')];
    const mock = makeMockOctokit([{ data, headers: {} }]);
    const result = await fetchPrFirstCommit(mock as never, 'owner', 'repo', 42);
    expect(result).toEqual(new Date('2025-01-01T10:00:00Z'));
  });
});
