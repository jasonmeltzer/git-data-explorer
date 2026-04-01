import { eq, sql } from 'drizzle-orm';
import { db, sqlite } from '../db/client.js';
import { authors, commits } from '../db/schema.js';
import { createOctokit } from './octokit.js';

type OctokitInstance = NonNullable<ReturnType<typeof createOctokit>>;

/**
 * Parse the last page number from a GitHub API Link header.
 * Exported for unit testing.
 *
 * Example input:
 *   '<https://api.github.com/repos/o/r/commits?author=x&per_page=1&page=42>; rel="last"'
 */
export function getLastPageFromLinkHeader(linkHeader: string | undefined): number | null {
  if (!linkHeader) return null;
  const match = /<([^>]+)>;\s*rel="last"/.exec(linkHeader);
  if (!match) return null;
  const url = new URL(match[1]);
  const page = parseInt(url.searchParams.get('page') ?? '', 10);
  return isNaN(page) ? null : page;
}

/**
 * Fetch the first commit date for a single author in a repo.
 *
 * Strategy (2-API-call maximum per author):
 * 1. Fetch 1 commit with per_page=1 — GitHub returns newest first.
 *    Parse the Link header to see if there are multiple pages.
 * 2. If there's only 1 page (or no Link header), the single result IS
 *    the only commit — return its date.
 * 3. If there are N pages, fetch page=N to get the oldest commit.
 *
 * Returns null if:
 * - octokit is null
 * - API returns empty data (author has no commits in this repo)
 * - Date string is missing from the commit
 */
export async function fetchAuthorFirstCommit(
  octokit: OctokitInstance | null,
  owner: string,
  repo: string,
  authorLogin: string,
): Promise<Date | null> {
  if (!octokit) return null;

  // First call: get newest commit + Link header for pagination info
  const firstResponse = await octokit.request('GET /repos/{owner}/{repo}/commits', {
    owner,
    repo,
    author: authorLogin,
    per_page: 1,
  });

  if (!firstResponse.data || firstResponse.data.length === 0) {
    return null;
  }

  const linkHeader = (firstResponse.headers as Record<string, string>)['link'];
  const lastPage = getLastPageFromLinkHeader(linkHeader);

  // If only 1 page, the first (and only) commit in firstResponse IS the oldest
  if (!lastPage || lastPage === 1) {
    const dateString = firstResponse.data[0].commit?.author?.date;
    if (!dateString) return null;
    return new Date(dateString);
  }

  // Multiple pages — fetch the last page to get the oldest commit
  const lastResponse = await octokit.request('GET /repos/{owner}/{repo}/commits', {
    owner,
    repo,
    author: authorLogin,
    per_page: 1,
    page: lastPage,
  });

  if (!lastResponse.data || lastResponse.data.length === 0) {
    // Fallback to first response date if last page unexpectedly empty
    const dateString = firstResponse.data[0].commit?.author?.date;
    if (!dateString) return null;
    return new Date(dateString);
  }

  const dateString = lastResponse.data[0].commit?.author?.date;
  if (!dateString) return null;
  return new Date(dateString);
}

/**
 * Fetch true first-commit dates for multiple authors in a repo.
 *
 * Creates its own Octokit instance (uses createOctokit() which reads the
 * stored PAT and applies the throttling plugin for rate-limit safety).
 *
 * Returns a Map<login, Date> with results for authors that have commits.
 * Authors with no commits in this repo are omitted from the Map.
 */
export async function fetchFirstCommitDates(
  repoOwner: string,
  repoName: string,
  authorLogins: string[],
): Promise<Map<string, Date>> {
  const octokit = createOctokit();
  const results = new Map<string, Date>();

  if (!octokit) return results;

  for (const login of authorLogins) {
    console.log(`Fetching first commit for ${login} in ${repoOwner}/${repoName}...`);
    const date = await fetchAuthorFirstCommit(octokit, repoOwner, repoName, login);
    if (date !== null) {
      results.set(login, date);
    }
  }

  return results;
}

/**
 * Update authors.first_commit_at for all non-bot authors that have commits
 * in the given repo, using true GitHub API dates.
 *
 * Uses MIN() pattern: only updates if the API date is earlier than the
 * locally-computed minimum, preserving accuracy across multiple repos.
 *
 * This is the main entry point called from the collection pipeline (D-18).
 */
export async function updateAuthorsFirstCommitDates(
  repoId: number,
  repoOwner: string,
  repoName: string,
): Promise<void> {
  // Query all non-bot author logins that have commits in this repo
  const authorRows = db
    .select({ login: authors.githubLogin })
    .from(authors)
    .innerJoin(commits, eq(commits.authorId, authors.id))
    .where(eq(commits.repoId, repoId))
    .groupBy(authors.id)
    .all()
    .filter((row) => row.login !== null);

  const authorLogins = authorRows.map((r) => r.login as string);

  if (authorLogins.length === 0) {
    console.log(`No authors found for ${repoOwner}/${repoName} — skipping first-commit fetch`);
    return;
  }

  // Filter out bots (double-check at query level)
  const nonBotLogins = db
    .select({ login: authors.githubLogin })
    .from(authors)
    .innerJoin(commits, eq(commits.authorId, authors.id))
    .where(eq(commits.repoId, repoId))
    .groupBy(authors.id)
    .all()
    .filter((row) => !row.login?.endsWith('[bot]') && row.login);

  const logins = nonBotLogins.map((r) => r.login as string);

  const firstCommitMap = await fetchFirstCommitDates(repoOwner, repoName, logins);

  // Update each author using MIN() pattern via prepared statement (avoids SQL injection on login)
  const updateStmt = sqlite.prepare(
    `UPDATE authors SET first_commit_at = MIN(COALESCE(first_commit_at, ?), ?) WHERE github_login = ?`,
  );

  let updatedCount = 0;
  for (const [login, date] of firstCommitMap) {
    const epochSeconds = Math.floor(date.getTime() / 1000);
    updateStmt.run(epochSeconds, epochSeconds, login);
    updatedCount++;
  }

  console.log(`Updated first commit dates for ${updatedCount} authors in ${repoOwner}/${repoName}`);
}
