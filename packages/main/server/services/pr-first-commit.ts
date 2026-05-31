import { createOctokit } from './octokit.js';

type OctokitInstance = NonNullable<ReturnType<typeof createOctokit>>;

/**
 * Phase 9.6 D-01/D-02/D-03/D-04: per-PR first-commit fetch.
 *
 * Fetches all commits on a PR via GET /repos/{owner}/{repo}/pulls/{pull_number}/commits,
 * iterating pages until the Link header has no rel="next". For each commit returns
 * MIN(authoredDate, committedDate). Across all commits returns the overall MIN.
 *
 * DIVERGES FROM LDX3 INTENTIONALLY (D-02): LDX3 uses committedDate only.
 * MIN(authoredDate, committedDate) preserves true "work started" timing through rebases —
 * LDX3's pure committedDate resets to rebase time and biases cycle time short for
 * long-running branches. See .planning/phases/09.6-cycle-time-correction-inserted/09.6-CONTEXT.md.
 *
 * Fail-soft per D-03: any throw returns null and logs a warning; the PR is still saved
 * with firstCommitAt=NULL and is naturally excluded from cycle-time medians via the
 * IS NOT NULL filter in analytics-pr-turnaround.ts (Plan 04).
 */
export async function fetchPrFirstCommit(
  // Accept any Octokit-shaped instance — the throttled collection Octokit and the
  // regular createOctokit() share the .request() shape used here. Tests inject a
  // minimal shape via `as never`/`as any` per the first-commit-fetcher.test.ts precedent.
  octokit: OctokitInstance | null,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<Date | null> {
  if (!octokit) return null;

  try {
    let overallMin: number = Number.POSITIVE_INFINITY;
    let page = 1;
    const perPage = 100;
    let hasNext = true;

    while (hasNext) {
      const response = await octokit.request(
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits',
        { owner, repo, pull_number: pullNumber, per_page: perPage, page },
      );
      const commits = response.data as Array<{
        commit?: {
          author?: { date?: string } | null;
          committer?: { date?: string } | null;
        };
      }>;
      if (!Array.isArray(commits) || commits.length === 0) {
        // First page empty → 0-commit PR (D-04)
        if (page === 1) return null;
        break;
      }
      for (const c of commits) {
        const authoredStr = c.commit?.author?.date;
        const committedStr = c.commit?.committer?.date;
        const authoredMs = authoredStr ? Date.parse(authoredStr) : NaN;
        const committedMs = committedStr ? Date.parse(committedStr) : NaN;
        // Per D-02 — MIN(authored, committed), skip NaN values
        const candidates: number[] = [];
        if (!isNaN(authoredMs)) candidates.push(authoredMs);
        if (!isNaN(committedMs)) candidates.push(committedMs);
        if (candidates.length === 0) continue;
        const commitMin = Math.min(...candidates);
        if (commitMin < overallMin) overallMin = commitMin;
      }
      const linkHeader = (response.headers as Record<string, string | undefined>)['link'];
      hasNext = !!linkHeader && /rel="next"/.test(linkHeader);
      if (hasNext) page += 1;
      // Safety bound — typical PRs have <30 commits, 99th-percentile <100, sanity cap at 50 pages = 5000 commits
      if (page > 50) {
        console.warn(`[pr-first-commit] aborting pagination at page 50 for ${owner}/${repo}#${pullNumber}`);
        break;
      }
    }

    if (!isFinite(overallMin)) return null;
    return new Date(overallMin);
  } catch (err) {
    console.warn(`[pr-first-commit] fetch failed for ${owner}/${repo}#${pullNumber}:`, err);
    return null;
  }
}
