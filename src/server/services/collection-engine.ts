import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { commits, pullRequests, authors } from '../db/schema.js';
import { readToken } from './token.js';
import {
  upsertCollectionState,
  getCollectionState,
  markCollectionPaused,
  markCollectionComplete,
} from './collection-state.js';
import { isBot } from './bot-detection.js';
import type { CollectionProgressEvent } from '../../shared/types.js';

/**
 * Custom error thrown when GitHub rate limit is hit during collection.
 * Allows the collection loop to stop cleanly at a page boundary.
 */
export class RateLimitError extends Error {
  retryAfter: number;
  isSecondary: boolean;

  constructor(retryAfter: number, isSecondary: boolean) {
    super(`Rate limit hit — retry after ${retryAfter}s${isSecondary ? ' (secondary)' : ''}`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.isSecondary = isSecondary;
  }
}

const CollectionOctokit = Octokit.plugin(throttling);

/**
 * Create a collection-specific Octokit that throws RateLimitError on rate limits
 * instead of retrying silently. This lets the collection engine handle pause/resume.
 */
export function createCollectionOctokit(): InstanceType<typeof CollectionOctokit> | null {
  const token = readToken();
  if (!token) return null;

  return new CollectionOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter: number, _options: { method: string; url: string }, _octokit: unknown, _retryCount: number) => {
        throw new RateLimitError(retryAfter, false);
      },
      onSecondaryRateLimit: (retryAfter: number, _options: { method: string; url: string }) => {
        const effectiveRetry = Math.max(retryAfter || 60, 60);
        throw new RateLimitError(effectiveRetry, true);
      },
    },
  });
}

type OctokitInstance = InstanceType<typeof CollectionOctokit>;

interface RepoInfo {
  id: number;
  fullName: string;
  ownerLogin: string;
  name: string;
  defaultBranch: string;
}

/**
 * Compute the ISO since/until boundaries for a full calendar month.
 */
function getMonthWindow(date: Date): { since: string; until: string } {
  return {
    since: startOfMonth(date).toISOString(),
    until: endOfMonth(date).toISOString(),
  };
}

/**
 * Upsert an author into the authors table.
 * Returns the author's DB id.
 */
function upsertAuthor(
  login: string,
  name: string | null,
  userType: string | null,
  commitDate: Date
): number {
  const bot = isBot(login, userType);

  db.insert(authors)
    .values({
      githubLogin: login,
      name: name ?? null,
      isBot: bot,
      firstCommitAt: commitDate,
    })
    .onConflictDoUpdate({
      target: authors.githubLogin,
      set: {
        name: sql`COALESCE(excluded.name, ${authors.name})`,
        isBot: bot,
        firstCommitAt: sql`MIN(${authors.firstCommitAt}, excluded.first_commit_at)`,
      },
    })
    .run();

  const row = db
    .select({ id: authors.id })
    .from(authors)
    .where(eq(authors.githubLogin, login))
    .get();
  return row!.id;
}

/**
 * Core collection engine that fetches GitHub commits and PRs for a repo,
 * checkpoints after each page/month, handles rate limits, and supports abort.
 */
export class CollectionEngine {
  private _listeners: Set<(event: CollectionProgressEvent) => void> = new Set();
  private _aborted: boolean = false;
  private _rateLimitResetAt: Date | null = null;
  private _rateLimitWaitTimer: NodeJS.Timeout | null = null;
  private _onResume: (() => void) | null = null;

  addProgressListener(fn: (event: CollectionProgressEvent) => void): void {
    this._listeners.add(fn);
  }

  removeProgressListener(fn: (event: CollectionProgressEvent) => void): void {
    this._listeners.delete(fn);
  }

  emitProgress(event: CollectionProgressEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break collection
      }
    }
  }

  abort(): void {
    this._aborted = true;
    if (this._rateLimitWaitTimer) {
      clearTimeout(this._rateLimitWaitTimer);
      this._rateLimitWaitTimer = null;
    }
  }

  isAborted(): boolean {
    return this._aborted;
  }

  resetAbort(): void {
    this._aborted = false;
  }

  get rateLimitResetAt(): Date | null {
    return this._rateLimitResetAt;
  }

  /**
   * Set the callback to invoke when rate-limit auto-resume fires.
   */
  setOnResume(fn: (() => void) | null): void {
    this._onResume = fn;
  }

  /**
   * Schedule auto-resume after a rate-limit pause (D-14).
   */
  private scheduleResume(retryAfterMs: number): void {
    if (this._rateLimitWaitTimer) {
      clearTimeout(this._rateLimitWaitTimer);
    }
    this._rateLimitWaitTimer = setTimeout(() => {
      this._rateLimitWaitTimer = null;
      this._rateLimitResetAt = null;
      if (this._onResume) {
        this._onResume();
      }
    }, retryAfterMs);
    // Don't block process exit for a rate-limit timer
    this._rateLimitWaitTimer.unref();
  }

  /**
   * Collect all commits and PRs for a single repo.
   * Emits progress events throughout. Checkpoints after each page/month.
   *
   * @param options.depthBoundary - oldest month to collect (default: 3 months back per D-02)
   * @param options.fetchAll - if true, bypass depth limit and collect full history (D-09)
   */
  async collectRepo(
    octokit: OctokitInstance,
    repo: RepoInfo,
    options?: { depthBoundary?: Date; fetchAll?: boolean }
  ): Promise<void> {
    this.emitProgress({
      type: 'repo_start',
      repoId: repo.id,
      repoFullName: repo.fullName,
    });

    try {
      await this.collectCommits(octokit, repo, options);
      await this.collectPRs(octokit, repo, options);

      this.emitProgress({
        type: 'repo_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
      });
    } catch (err) {
      if (err instanceof RateLimitError) {
        const resetAt = new Date(Date.now() + err.retryAfter * 1000);
        this._rateLimitResetAt = resetAt;

        // Mark both resources as paused
        markCollectionPaused(repo.id, 'commits', err.message, resetAt.toISOString());
        markCollectionPaused(repo.id, 'pull_requests', err.message, resetAt.toISOString());

        this.emitProgress({
          type: err.isSecondary ? 'secondary_rate_limit' : 'rate_limit',
          repoId: repo.id,
          repoFullName: repo.fullName,
          rateLimitResetAt: resetAt.toISOString(),
          errorMessage: err.message,
        });

        // Schedule auto-resume (D-14)
        const retryMs = err.isSecondary
          ? Math.max(err.retryAfter, 60) * 1000 + 2000 // 60s minimum + 2s buffer for secondary
          : err.retryAfter * 1000 + 2000; // retry-after + 2s buffer for primary
        this.scheduleResume(retryMs);

        // Re-throw so the queue knows this repo was rate-limited
        throw err;
      }

      // Non-rate-limit error
      const errorMessage = err instanceof Error ? err.message : String(err);
      upsertCollectionState(repo.id, 'commits', { status: 'error', errorMessage });
      upsertCollectionState(repo.id, 'pull_requests', { status: 'error', errorMessage });

      this.emitProgress({
        type: 'error',
        repoId: repo.id,
        repoFullName: repo.fullName,
        errorMessage,
      });
    }
  }

  /**
   * Fetch commits using month-window iteration from newest to oldest (D-01, D-02).
   * Uses since+until params for bounded month windows — never fetches full history by accident.
   * Checkpoints oldest month collected after each complete month.
   * Supports resume: if direction='reverse' and oldestMonthCollected exists, resumes from there.
   */
  private async collectCommits(
    octokit: OctokitInstance,
    repo: RepoInfo,
    options?: { depthBoundary?: Date; fetchAll?: boolean }
  ): Promise<void> {
    const existing = getCollectionState(repo.id, 'commits');

    // Compute depth boundary:
    // - fetchAll=true → go back to epoch (all history)
    // - options.depthBoundary provided → use it
    // - default → 3 months back from start of current month (D-02)
    const depthBoundary = options?.fetchAll
      ? new Date(0)
      : (options?.depthBoundary ?? startOfMonth(subMonths(new Date(), 2)));

    // Incremental sync: if already complete and depth hasn't expanded,
    // just fetch commits newer than our cursor (last seen commit date)
    if (existing?.status === 'complete' && existing.direction === 'reverse' && existing.depthTarget && !options?.fetchAll) {
      const prevTarget = new Date(existing.depthTarget);
      if (depthBoundary >= prevTarget) {
        if (existing.cursor) {
          await this.collectCommitsIncremental(octokit, repo, existing.cursor);
        }
        markCollectionComplete(repo.id, 'commits');
        return;
      }
    }

    // Full collection: iterate month-by-month from current month backward to depthBoundary
    let currentMonth = startOfMonth(new Date());

    if (existing?.direction === 'reverse' && existing.oldestMonthCollected) {
      currentMonth = startOfMonth(subMonths(new Date(existing.oldestMonthCollected), 1));
    }

    let totalItems = 0;
    let newestCommitDate: string | undefined;

    while (currentMonth >= depthBoundary && !this._aborted) {
      const { since, until } = getMonthWindow(currentMonth);
      const monthNewest = await this.collectCommitsForMonth(octokit, repo, since, until);
      if (monthNewest && (!newestCommitDate || monthNewest > newestCommitDate)) {
        newestCommitDate = monthNewest;
      }

      if (this._aborted) {
        upsertCollectionState(repo.id, 'commits', {
          direction: 'reverse',
          status: 'paused',
          depthTarget: depthBoundary.toISOString(),
          ...(newestCommitDate ? { cursor: newestCommitDate } : {}),
        });
        return;
      }

      // Month complete — checkpoint
      upsertCollectionState(repo.id, 'commits', {
        direction: 'reverse',
        oldestMonthCollected: since,
        depthTarget: depthBoundary.toISOString(),
        status: 'in_progress',
        ...(newestCommitDate ? { cursor: newestCommitDate } : {}),
      });

      totalItems++;

      this.emitProgress({
        type: 'page_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
        resourceType: 'commits',
        itemsInPage: 0,
        totalItemsSoFar: totalItems,
      });

      currentMonth = startOfMonth(subMonths(currentMonth, 1));
    }

    // Store the newest commit date as cursor for future incremental syncs
    if (newestCommitDate) {
      upsertCollectionState(repo.id, 'commits', { cursor: newestCommitDate });
    }
    markCollectionComplete(repo.id, 'commits');
  }

  /**
   * Incremental sync: fetch only commits newer than the cursor (last seen commit date).
   * Used when a repo is already complete and depth hasn't changed.
   */
  private async collectCommitsIncremental(
    octokit: OctokitInstance,
    repo: RepoInfo,
    cursor: string,
  ): Promise<void> {
    // Fetch commits since cursor (no until — open-ended to now)
    const since = cursor;
    let newestDate = cursor;

    const iterator = octokit.paginate.iterator(
      octokit.rest.repos.listCommits,
      {
        owner: repo.ownerLogin,
        repo: repo.name,
        since,
        per_page: 100,
      } as Parameters<typeof octokit.rest.repos.listCommits>[0]
    );

    for await (const response of iterator) {
      if (this._aborted) return;
      const page = response.data;
      if (page.length === 0) break;

      for (const commit of page) {
        const commitData = commit as Record<string, unknown>;
        const commitMeta = commitData.commit as { author?: { name?: string; date?: string }; message?: string } | undefined;
        const authorData = commitData.author as { login?: string; type?: string } | null;

        const login = authorData?.login ?? commitMeta?.author?.name ?? 'unknown';
        const authorName = commitMeta?.author?.name ?? null;
        const userType = authorData?.type ?? null;
        const dateStr = commitMeta?.author?.date ?? new Date().toISOString();
        const commitDate = new Date(dateStr);
        const sha = commitData.sha as string;
        const message = commitMeta?.message ?? '';

        const authorId = upsertAuthor(login, authorName, userType, commitDate);

        let linesAdded = 0, linesDeleted = 0, filesChanged = 0;
        const stats = (commitData as { stats?: { additions?: number; deletions?: number } }).stats;
        const files = (commitData as { files?: Array<unknown> }).files;

        if (stats) {
          linesAdded = stats.additions ?? 0;
          linesDeleted = stats.deletions ?? 0;
          filesChanged = files?.length ?? 0;
        } else {
          try {
            const detail = await octokit.rest.repos.getCommit({ owner: repo.ownerLogin, repo: repo.name, ref: sha });
            const d = detail.data as Record<string, unknown>;
            linesAdded = ((d as { stats?: { additions?: number } }).stats?.additions) ?? 0;
            linesDeleted = ((d as { stats?: { deletions?: number } }).stats?.deletions) ?? 0;
            filesChanged = ((d as { files?: Array<unknown> }).files?.length) ?? 0;
          } catch { /* continue with zeros */ }
        }

        db.insert(commits)
          .values({ sha, repoId: repo.id, authorId, message, committedAt: commitDate, linesAdded, linesDeleted, filesChanged })
          .onConflictDoUpdate({
            target: [commits.sha, commits.repoId],
            set: {
              linesAdded: sql`CASE WHEN ${commits.linesAdded} = 0 THEN excluded.lines_added ELSE ${commits.linesAdded} END`,
              linesDeleted: sql`CASE WHEN ${commits.linesDeleted} = 0 THEN excluded.lines_deleted ELSE ${commits.linesDeleted} END`,
              filesChanged: sql`CASE WHEN ${commits.filesChanged} = 0 THEN excluded.files_changed ELSE ${commits.filesChanged} END`,
              authorId,
            },
          })
          .run();

        if (dateStr > newestDate) newestDate = dateStr;
      }
    }

    // Update cursor to the newest commit we've seen
    if (newestDate > cursor) {
      upsertCollectionState(repo.id, 'commits', { cursor: newestDate });
    }
  }

  /**
   * Fetch all commits for a single calendar month using since+until bounds.
   * Processes all pages for the month. Checkpoints within-month cursor for rate-limit resume.
   * Returns the newest commit date found in this month (for cursor tracking).
   */
  private async collectCommitsForMonth(
    octokit: OctokitInstance,
    repo: RepoInfo,
    since: string,
    until: string,
  ): Promise<string | undefined> {
    let totalItems = 0;

    const iterator = octokit.paginate.iterator(
      octokit.rest.repos.listCommits,
      {
        owner: repo.ownerLogin,
        repo: repo.name,
        since,
        until,
        per_page: 100,
      } as Parameters<typeof octokit.rest.repos.listCommits>[0]
    );

    let newestCommitDate: string | undefined;

    for await (const response of iterator) {
      if (this._aborted) return newestCommitDate;

      const page = response.data;
      if (page.length === 0) break;

      // Check if we need individual stats fetches
      let needsIndividualStats = false;
      const firstCommit = page[0] as Record<string, unknown>;
      if (!(firstCommit as { stats?: unknown }).stats) {
        needsIndividualStats = true;
      }

      let lastCommitDate: string | undefined;

      for (const commit of page) {
        const commitData = commit as Record<string, unknown>;
        const commitMeta = commitData.commit as { author?: { name?: string; date?: string }; message?: string } | undefined;
        const authorData = commitData.author as { login?: string; type?: string } | null;

        const login = authorData?.login ?? commitMeta?.author?.name ?? 'unknown';
        const authorName = commitMeta?.author?.name ?? null;
        const userType = authorData?.type ?? null;
        const dateStr = commitMeta?.author?.date ?? new Date().toISOString();
        const commitDate = new Date(dateStr);
        const sha = commitData.sha as string;
        const message = commitMeta?.message ?? '';

        const authorId = upsertAuthor(login, authorName, userType, commitDate);

        let linesAdded = 0;
        let linesDeleted = 0;
        let filesChanged = 0;

        const stats = (commitData as { stats?: { additions?: number; deletions?: number; total?: number } }).stats;
        const files = (commitData as { files?: Array<unknown> }).files;

        if (stats) {
          linesAdded = stats.additions ?? 0;
          linesDeleted = stats.deletions ?? 0;
          filesChanged = files?.length ?? 0;
        } else if (needsIndividualStats) {
          try {
            const detail = await octokit.rest.repos.getCommit({
              owner: repo.ownerLogin,
              repo: repo.name,
              ref: sha,
            });
            const detailData = detail.data as Record<string, unknown>;
            const detailStats = (detailData as { stats?: { additions?: number; deletions?: number } }).stats;
            const detailFiles = (detailData as { files?: Array<unknown> }).files;
            linesAdded = detailStats?.additions ?? 0;
            linesDeleted = detailStats?.deletions ?? 0;
            filesChanged = detailFiles?.length ?? 0;
          } catch {
            // If individual fetch fails, continue with zeros
          }
        }

        // Upsert commit — dedup on (sha, repoId) via unique index
        db.insert(commits)
          .values({
            sha,
            repoId: repo.id,
            authorId,
            message,
            committedAt: commitDate,
            linesAdded,
            linesDeleted,
            filesChanged,
          })
          .onConflictDoUpdate({
            target: [commits.sha, commits.repoId],
            set: {
              linesAdded: sql`CASE WHEN ${commits.linesAdded} = 0 THEN excluded.lines_added ELSE ${commits.linesAdded} END`,
              linesDeleted: sql`CASE WHEN ${commits.linesDeleted} = 0 THEN excluded.lines_deleted ELSE ${commits.linesDeleted} END`,
              filesChanged: sql`CASE WHEN ${commits.filesChanged} = 0 THEN excluded.files_changed ELSE ${commits.filesChanged} END`,
              authorId,
            },
          })
          .run();

        lastCommitDate = dateStr;
        if (!newestCommitDate || dateStr > newestCommitDate) {
          newestCommitDate = dateStr;
        }
      }

      // Checkpoint within-month cursor for rate-limit resume (Pitfall 6)
      upsertCollectionState(repo.id, 'commits', {
        cursor: lastCommitDate,
        status: 'in_progress',
        direction: 'reverse',
      });

      totalItems += page.length;

      this.emitProgress({
        type: 'page_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
        resourceType: 'commits',
        itemsInPage: page.length,
        totalItemsSoFar: totalItems,
      });
    }

    return newestCommitDate;
  }

  /**
   * Fetch PRs using reverse-chronological sort (sort=created direction=desc) with early-exit
   * at depthBoundary (D-03). Checkpoints the most-recent cursor for incremental forward syncs (D-04).
   *
   * Per Pitfall 2: process ALL PRs on a page that are within the window BEFORE breaking.
   */
  private async collectPRs(
    octokit: OctokitInstance,
    repo: RepoInfo,
    options?: { depthBoundary?: Date; fetchAll?: boolean }
  ): Promise<void> {
    const existing = getCollectionState(repo.id, 'pull_requests');

    // Incremental sync: if already complete and depth hasn't expanded,
    // fetch only PRs newer than our cursor
    if (existing?.status === 'complete' && existing.direction === 'reverse' && existing.depthTarget && !options?.fetchAll) {
      const prevTarget = new Date(existing.depthTarget);
      const depthBoundary = options?.depthBoundary ?? startOfMonth(subMonths(new Date(), 2));
      if (depthBoundary >= prevTarget) {
        if (existing.cursor) {
          await this.collectPRsIncremental(octokit, repo, existing.cursor);
        }
        markCollectionComplete(repo.id, 'pull_requests');
        return;
      }
    }

    const depthBoundary = options?.fetchAll
      ? new Date(0)
      : (options?.depthBoundary ?? startOfMonth(subMonths(new Date(), 2)));

    let totalItems = 0;

    const iterator = octokit.paginate.iterator(
      octokit.rest.pulls.list,
      {
        owner: repo.ownerLogin,
        repo: repo.name,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      }
    );

    for await (const response of iterator) {
      if (this._aborted) {
        upsertCollectionState(repo.id, 'pull_requests', {
          status: 'paused',
          direction: 'reverse',
          depthTarget: depthBoundary.toISOString(),
        });
        return;
      }

      const page = response.data;
      if (page.length === 0) break;

      let reachedBoundary = false;
      let pageItems = 0;

      for (const pr of page) {
        const prData = pr as Record<string, unknown>;
        const createdAt = new Date(prData.created_at as string);

        if (createdAt < depthBoundary) {
          reachedBoundary = true;
          break;
        }

        // Fetch full PR details for stats
        const prNumber = prData.number as number;
        let linesAdded = 0;
        let linesDeleted = 0;
        let filesChanged = 0;
        let commitCount = 0;

        try {
          const detail = await octokit.rest.pulls.get({
            owner: repo.ownerLogin,
            repo: repo.name,
            pull_number: prNumber,
          });
          const detailData = detail.data as Record<string, unknown>;
          linesAdded = (detailData.additions as number) ?? 0;
          linesDeleted = (detailData.deletions as number) ?? 0;
          filesChanged = (detailData.changed_files as number) ?? 0;
          commitCount = (detailData.commits as number) ?? 0;
        } catch {
          // Continue with zeros if individual fetch fails
        }

        const user = prData.user as { login?: string; type?: string } | null;
        const login = user?.login ?? 'unknown';
        const userType = user?.type ?? null;

        const authorId = upsertAuthor(login, null, userType, createdAt);

        const githubId = prData.id as number;
        const title = prData.title as string;
        const state = prData.state as string;
        const updatedAt = prData.updated_at as string;
        const mergedAt = prData.merged_at ? new Date(prData.merged_at as string) : null;
        const closedAt = prData.closed_at ? new Date(prData.closed_at as string) : null;

        // Upsert PR — dedup on (githubId, repoId)
        db.insert(pullRequests)
          .values({
            githubId,
            repoId: repo.id,
            authorId,
            number: prNumber,
            title,
            state,
            createdAt,
            mergedAt,
            closedAt,
            updatedAt: new Date(updatedAt),
            linesAdded,
            linesDeleted,
            filesChanged,
            commitCount,
          })
          .onConflictDoUpdate({
            target: [pullRequests.githubId, pullRequests.repoId],
            set: {
              title,
              state,
              mergedAt,
              closedAt,
              updatedAt: new Date(updatedAt),
              linesAdded,
              linesDeleted,
              filesChanged,
              commitCount,
              authorId,
            },
          })
          .run();

        pageItems++;
      }

      // Checkpoint: track the most recent PR's created_at as cursor for incremental forward syncs (D-04)
      // The first PR in the first page is the most recent (desc sort)
      const newestPR = page[0] as Record<string, unknown>;
      upsertCollectionState(repo.id, 'pull_requests', {
        cursor: newestPR.created_at as string,
        status: 'in_progress',
        direction: 'reverse',
        depthTarget: depthBoundary.toISOString(),
      });

      totalItems += pageItems;

      this.emitProgress({
        type: 'page_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
        resourceType: 'pull_requests',
        itemsInPage: pageItems,
        totalItemsSoFar: totalItems,
      });

      if (reachedBoundary) break;
    }

    markCollectionComplete(repo.id, 'pull_requests');
  }

  /**
   * Incremental PR sync: fetch PRs created after the cursor timestamp.
   * Uses sort=created direction=desc and stops when we reach the cursor.
   */
  private async collectPRsIncremental(
    octokit: OctokitInstance,
    repo: RepoInfo,
    cursor: string,
  ): Promise<void> {
    const cursorDate = new Date(cursor);
    let newestDate = cursor;

    const iterator = octokit.paginate.iterator(
      octokit.rest.pulls.list,
      {
        owner: repo.ownerLogin,
        repo: repo.name,
        state: 'all',
        sort: 'created',
        direction: 'desc',
        per_page: 100,
      }
    );

    for await (const response of iterator) {
      if (this._aborted) return;
      const page = response.data;
      if (page.length === 0) break;

      let reachedCursor = false;

      for (const pr of page) {
        const prData = pr as Record<string, unknown>;
        const createdAt = new Date(prData.created_at as string);

        if (createdAt <= cursorDate) {
          reachedCursor = true;
          break;
        }

        const prNumber = prData.number as number;
        let linesAdded = 0, linesDeleted = 0, filesChanged = 0, commitCount = 0;

        try {
          const detail = await octokit.rest.pulls.get({ owner: repo.ownerLogin, repo: repo.name, pull_number: prNumber });
          const d = detail.data as Record<string, unknown>;
          linesAdded = (d.additions as number) ?? 0;
          linesDeleted = (d.deletions as number) ?? 0;
          filesChanged = (d.changed_files as number) ?? 0;
          commitCount = (d.commits as number) ?? 0;
        } catch { /* continue with zeros */ }

        const user = prData.user as { login?: string; type?: string } | null;
        const login = user?.login ?? 'unknown';
        const userType = user?.type ?? null;
        const authorId = upsertAuthor(login, null, userType, createdAt);

        const githubId = prData.id as number;
        const title = prData.title as string;
        const state = prData.state as string;
        const updatedAt = prData.updated_at as string;
        const mergedAt = prData.merged_at ? new Date(prData.merged_at as string) : null;
        const closedAt = prData.closed_at ? new Date(prData.closed_at as string) : null;

        db.insert(pullRequests)
          .values({ githubId, repoId: repo.id, authorId, number: prNumber, title, state, createdAt, mergedAt, closedAt, updatedAt: new Date(updatedAt), linesAdded, linesDeleted, filesChanged, commitCount })
          .onConflictDoUpdate({
            target: [pullRequests.githubId, pullRequests.repoId],
            set: { title, state, mergedAt, closedAt, updatedAt: new Date(updatedAt), linesAdded, linesDeleted, filesChanged, commitCount, authorId },
          })
          .run();

        const dateStr = prData.created_at as string;
        if (dateStr > newestDate) newestDate = dateStr;
      }

      if (reachedCursor) break;
    }

    if (newestDate > cursor) {
      upsertCollectionState(repo.id, 'pull_requests', { cursor: newestDate });
    }
  }
}
