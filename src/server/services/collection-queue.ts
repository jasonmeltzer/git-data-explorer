import { eq, sql } from 'drizzle-orm';
import { startOfMonth, subMonths, differenceInCalendarMonths } from 'date-fns';
import { db } from '../db/client.js';
import { authors } from '../db/schema.js';
import { CollectionEngine, RateLimitError, createCollectionOctokit } from './collection-engine.js';
import { getTrackedRepos } from './repo-management.js';
import {
  getCollectionState,
  getIncompleteCollections,
  getRepoItemCounts,
  getDepthSetting,
  getOldestMonthCollected,
  resetMidCollectionRepo,
} from './collection-state.js';
import type {
  CollectionProgressEvent,
  CollectionRepoStatus,
  CollectionBatchStatus,
  CollectionRepoOverallStatus,
} from '../../shared/types.js';

// Module-level flag: ensure legacy repo transition runs only once per process (D-10/D-11)
let _transitionDone = false;

/**
 * In-memory queue that orchestrates sequential repo collection.
 * Provides start/stop/skip controls and exposes status for the API.
 */
export class CollectionQueue {
  private engine: CollectionEngine;
  private queue: Array<{
    id: number;
    fullName: string;
    ownerLogin: string;
    name: string;
    defaultBranch: string;
  }> = [];
  private currentIndex: number = -1;
  private _isActive: boolean = false;
  private _fetchAll: boolean = false;
  private _listeners: Set<(event: CollectionProgressEvent) => void> = new Set();
  private _rateLimitInfo: {
    remaining: number | null;
    total: number | null;
    resetAt: string | null;
  } = { remaining: null, total: null, resetAt: null };

  constructor() {
    this.engine = new CollectionEngine();

    // Wire engine progress events to our listeners
    this.engine.addProgressListener((event) => {
      // Track rate limit info
      if (event.type === 'rate_limit' || event.type === 'secondary_rate_limit') {
        this._rateLimitInfo = {
          remaining: event.rateLimitRemaining ?? 0,
          total: event.rateLimitTotal ?? null,
          resetAt: event.rateLimitResetAt ?? null,
        };
      }
      this.emitProgress(event);
    });

    // Wire auto-resume to continue the batch
    this.engine.setOnResume(() => {
      this.resumeAfterRateLimit();
    });
  }

  /**
   * Start batch collection for all tracked repos (or a subset).
   * Per D-01/D-03: processes repos sequentially.
   * Per D-04: first sync orders by size ascending; subsequent by item count.
   * Per D-10/D-11: transitions legacy Phase 3 repos on first batch start.
   */
  async startBatch(repoIds?: number[], options?: { fetchAll?: boolean }): Promise<void> {
    if (this._isActive) return;

    this._fetchAll = options?.fetchAll ?? false;

    // Transition legacy Phase 3 repos (runs only once per process)
    this.transitionLegacyRepos();

    const tracked = getTrackedRepos();
    let repos = repoIds
      ? tracked.filter((r) => repoIds.includes(r.id))
      : tracked;

    // Sort: first-time repos (no complete state) by name; rest by item count
    repos = [...repos].sort((a, b) => {
      const aCounts = getRepoItemCounts(a.id);
      const bCounts = getRepoItemCounts(b.id);
      const aTotal = aCounts.commits + aCounts.prs;
      const bTotal = bCounts.commits + bCounts.prs;
      // Repos with no data yet go first (first sync)
      if (aTotal === 0 && bTotal > 0) return -1;
      if (bTotal === 0 && aTotal > 0) return 1;
      return aTotal - bTotal;
    });

    this.queue = repos.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      ownerLogin: r.ownerLogin,
      name: r.name,
      defaultBranch: r.defaultBranch,
    }));
    this.currentIndex = 0;
    this._isActive = true;
    this.engine.resetAbort();

    await this.processQueue();
  }

  /**
   * Start collection for a single repo immediately (D-02).
   * Called from repositories.ts when exactly 1 repo is added.
   */
  async startSingleRepo(repoId: number, options?: { fetchAll?: boolean }): Promise<void> {
    const tracked = getTrackedRepos();
    const repo = tracked.find((r) => r.id === repoId);
    if (!repo) return;

    this._fetchAll = options?.fetchAll ?? false;

    if (this._isActive) {
      // Queue is already running — add to end
      this.queue.push({
        id: repo.id,
        fullName: repo.fullName,
        ownerLogin: repo.ownerLogin,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
      });
      return;
    }

    this.queue = [{
      id: repo.id,
      fullName: repo.fullName,
      ownerLogin: repo.ownerLogin,
      name: repo.name,
      defaultBranch: repo.defaultBranch,
    }];
    this.currentIndex = 0;
    this._isActive = true;
    this.engine.resetAbort();

    await this.processQueue();
  }

  /**
   * Stop all collection (D-05). Current repo's progress is checkpointed.
   */
  stopAll(): void {
    this.engine.abort();
    this._isActive = false;
    this.currentIndex = -1;
    this.queue = [];
  }

  /**
   * Skip the current repo and continue with the next (D-05).
   */
  skipCurrent(): void {
    if (!this._isActive) return;
    this.engine.abort();
    // The abort will cause the current collectRepo call to checkpoint and return.
    // processQueue loop will then advance to next repo.
  }

  /**
   * Get the full batch status including per-repo detail (D-09).
   */
  getStatus(): CollectionBatchStatus {
    const tracked = getTrackedRepos();
    const depthMonths = getDepthSetting();
    const repoStatuses: CollectionRepoStatus[] = tracked.map((repo) => {
      const commitState = getCollectionState(repo.id, 'commits');
      const prState = getCollectionState(repo.id, 'pull_requests');
      const counts = getRepoItemCounts(repo.id);

      // Derive overall status
      let status: CollectionRepoOverallStatus = 'pending';
      const commitStatus = commitState?.status;
      const prStatus = prState?.status;

      if (commitStatus === 'error' || prStatus === 'error') {
        status = 'error';
      } else if (commitStatus === 'paused' || prStatus === 'paused') {
        status = 'paused';
      } else if (commitStatus === 'in_progress' || prStatus === 'in_progress') {
        // Check if this is a re-sync (D-12)
        const hasCompleted = (commitState?.status === 'complete') || (prState?.status === 'complete');
        status = hasCompleted ? 'updating' : 'collecting';
      } else if (commitStatus === 'complete' && prStatus === 'complete') {
        status = 'complete';
      }

      // Determine if first sync
      const isFirstSync = !commitState || commitState.status !== 'complete';

      // Last synced: most recent lastRunAt where status='complete'
      let lastSyncedAt: string | null = null;
      if (commitState?.status === 'complete' && commitState.lastRunAt) {
        lastSyncedAt = new Date(commitState.lastRunAt).toISOString();
      }
      if (prState?.status === 'complete' && prState.lastRunAt) {
        const prSynced = new Date(prState.lastRunAt).toISOString();
        if (!lastSyncedAt || prSynced > lastSyncedAt) {
          lastSyncedAt = prSynced;
        }
      }

      // Error message
      const errorMessage = commitState?.errorMessage ?? prState?.errorMessage ?? null;

      // Compute months collected using date-fns differenceInCalendarMonths (D-13)
      // Use the more conservative (later/fewer months) of commits and PRs oldest month
      let monthsCollected: number | null = null;
      const commitOldest = getOldestMonthCollected(repo.id, 'commits');
      const prOldest = getOldestMonthCollected(repo.id, 'pull_requests');
      const effectiveOldest = commitOldest && prOldest
        ? (commitOldest > prOldest ? commitOldest : prOldest) // later date = fewer months = bottleneck
        : (commitOldest ?? prOldest);

      if (effectiveOldest) {
        const oldestDate = new Date(effectiveOldest);
        monthsCollected = differenceInCalendarMonths(startOfMonth(new Date()), oldestDate) + 1;
      }

      return {
        repoId: repo.id,
        fullName: repo.fullName,
        ownerLogin: repo.ownerLogin,
        name: repo.name,
        status,
        commitsCollected: counts.commits,
        prsCollected: counts.prs,
        lastSyncedAt,
        errorMessage,
        isFirstSync,
        monthsCollected,
        depthMonths,
      };
    });

    // Bot count
    const botCountResult = db
      .select({ count: sql<number>`count(*)` })
      .from(authors)
      .where(eq(authors.isBot, true))
      .get();
    const botsExcludedCount = botCountResult?.count ?? 0;

    // Compute max meaningful depth from oldest tracked repo's GitHub creation date
    const oldestRepoCreatedAt = tracked.reduce((oldest, r) => {
      const created = r.repoCreatedAt;
      if (!created) return oldest;
      return !oldest || created < oldest ? created : oldest;
    }, null as Date | null);
    const maxDepthMonths = oldestRepoCreatedAt
      ? Math.max(1, differenceInCalendarMonths(startOfMonth(new Date()), startOfMonth(oldestRepoCreatedAt)) + 1)
      : 120;  // fallback if no creation dates stored yet

    return {
      isActive: this._isActive,
      repoStatuses,
      rateLimitRemaining: this._rateLimitInfo.remaining,
      rateLimitTotal: this._rateLimitInfo.total,
      rateLimitResetAt: this._rateLimitInfo.resetAt,
      botsExcludedCount,
      depthMonths,
      maxDepthMonths,
    };
  }

  /**
   * Add a progress listener (for SSE streaming).
   */
  addProgressListener(fn: (event: CollectionProgressEvent) => void): void {
    this._listeners.add(fn);
  }

  /**
   * Remove a progress listener.
   */
  removeProgressListener(fn: (event: CollectionProgressEvent) => void): void {
    this._listeners.delete(fn);
  }

  /**
   * Get incomplete collections for cross-session resume (D-16).
   */
  getIncompleteForResume(): {
    hasIncomplete: boolean;
    incomplete: Array<{
      repoId: number;
      resourceType: string;
      status: string;
      errorMessage: string | null;
    }>;
  } {
    const incomplete = getIncompleteCollections();
    return {
      hasIncomplete: incomplete.length > 0,
      incomplete: incomplete.map((c) => ({
        repoId: c.repoId,
        resourceType: c.resourceType,
        status: c.status,
        errorMessage: c.errorMessage,
      })),
    };
  }

  /**
   * Transition legacy Phase 3 repos to the new reverse-chronological strategy (D-10, D-11).
   * Runs only once per process (controlled by module-level _transitionDone flag).
   *
   * D-10: Complete repos keep all data — skipped here.
   * D-11: Mid-collection repos (in_progress/paused with no direction or direction='forward')
   *       are reset: data deleted and collection state cleared for restart.
   */
  private transitionLegacyRepos(): void {
    if (_transitionDone) return;
    _transitionDone = true;

    const tracked = getTrackedRepos();
    for (const repo of tracked) {
      const commitState = getCollectionState(repo.id, 'commits');
      const prState = getCollectionState(repo.id, 'pull_requests');

      // D-10: Complete repos keep all data — skip them entirely
      if (commitState?.status === 'complete' && prState?.status === 'complete') {
        continue;
      }

      // D-11: Mid-collection repos (in_progress or paused with no direction or direction='forward')
      // are reset: delete data and restart with reverse strategy
      const isMidCollection = (state: typeof commitState): boolean =>
        !!(state &&
        (state.status === 'in_progress' || state.status === 'paused') &&
        (!state.direction || state.direction === 'forward'));

      if (isMidCollection(commitState) || isMidCollection(prState)) {
        resetMidCollectionRepo(repo.id);
      }
    }
  }

  /**
   * Emit a progress event to all listeners.
   */
  private emitProgress(event: CollectionProgressEvent): void {
    for (const listener of this._listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors should not break the queue
      }
    }
  }

  /**
   * Process the queue sequentially — one repo at a time (D-03).
   */
  private async processQueue(): Promise<void> {
    const octokit = createCollectionOctokit();
    if (!octokit) {
      this._isActive = false;
      return;
    }

    // Compute depth boundary from global setting (D-06, D-07)
    // depthMonths=3, today=March → boundary=start of January (current month - (depthMonths-1))
    const depthMonths = getDepthSetting();
    const depthBoundary = startOfMonth(subMonths(new Date(), depthMonths - 1));

    while (this.currentIndex < this.queue.length && this._isActive) {
      const repo = this.queue[this.currentIndex];
      this.engine.resetAbort();

      try {
        await this.engine.collectRepo(octokit, repo, {
          depthBoundary,
          fetchAll: this._fetchAll,
        });
      } catch (err) {
        if (err instanceof RateLimitError) {
          // Rate limit hit — engine has scheduled auto-resume
          // Don't advance; resume will pick up from here
          return;
        }
        // Non-rate-limit error — skip this repo and continue
      }

      this.currentIndex++;

      this.emitProgress({
        type: 'repo_complete',
        repoId: repo.id,
        repoFullName: repo.fullName,
        reposCompleted: this.currentIndex,
        reposTotal: this.queue.length,
      });
    }

    // Batch complete
    if (this._isActive) {
      this._isActive = false;
      this.emitProgress({
        type: 'batch_complete',
        repoId: 0,
        repoFullName: '',
        reposCompleted: this.queue.length,
        reposTotal: this.queue.length,
      });
    }
  }

  /**
   * Resume collection after a rate-limit pause (D-14).
   * Called by the engine's auto-resume timer.
   */
  private async resumeAfterRateLimit(): Promise<void> {
    this._rateLimitInfo = { remaining: null, total: null, resetAt: null };

    if (!this._isActive || this.currentIndex < 0) return;

    await this.processQueue();
  }
}

// Module-level singleton — shared by routes and repositories
export const collectionQueue = new CollectionQueue();
