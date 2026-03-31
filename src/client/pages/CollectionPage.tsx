import { useState, useMemo, useEffect } from 'react';
import { startOfMonth, subMonths, format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Progress } from '@shared/components/ui/progress';
import { Separator } from '@shared/components/ui/separator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/components/ui/alert-dialog';
import {
  RefreshCw,
  CircleDashed,
  Loader2,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { useCollectionSSE } from '../hooks/useCollectionSSE.js';
import type {
  TrackedRepo,
  CollectionBatchStatus,
  CollectionRepoStatus,
  CollectionRepoOverallStatus,
} from '@shared/types.js';

function getStatusIcon(status: CollectionRepoOverallStatus) {
  switch (status) {
    case 'pending':
      return <CircleDashed className="h-4 w-4 text-muted-foreground" />;
    case 'collecting':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case 'updating':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    case 'complete':
      return <CheckCircle2 className="h-4 w-4 text-muted-foreground" />;
    case 'paused':
      return <PauseCircle className="h-4 w-4 text-muted-foreground" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />;
  }
}

function getStatusBadge(
  status: CollectionRepoOverallStatus,
  isFirstSync: boolean,
  monthsCollected?: number | null,
  depthMonths?: number,
) {
  // For complete repos with partial month coverage, show partial badge
  if (status === 'complete' && monthsCollected != null && depthMonths != null && monthsCollected < depthMonths) {
    return <Badge variant="secondary">{monthsCollected} of {depthMonths} months</Badge>;
  }

  switch (status) {
    case 'pending':
      return <Badge variant="secondary">Queued</Badge>;
    case 'collecting':
      return (
        <Badge className="bg-primary text-primary-foreground">
          {isFirstSync ? 'Collecting' : 'Updating'}
        </Badge>
      );
    case 'updating':
      return <Badge className="bg-primary text-primary-foreground">Updating</Badge>;
    case 'complete':
      return null;
    case 'paused':
      return <Badge variant="secondary">Paused</Badge>;
    case 'error':
      return (
        <Badge variant="outline" className="text-destructive border-destructive">
          Error
        </Badge>
      );
  }
}

function formatResetTime(resetAt: string): string {
  return new Date(resetAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CollectionPage() {
  const queryClient = useQueryClient();

  // Data fetching — collection status
  const [isCollecting, setIsCollecting] = useState(false);

  const { data: collectionStatus } = useQuery({
    queryKey: ['collection', 'status'],
    queryFn: () =>
      fetch('/api/collection/status').then(r => r.json() as Promise<CollectionBatchStatus>),
    refetchInterval: isCollecting ? 3000 : 30000,
  });

  const { data: resumeInfo } = useQuery({
    queryKey: ['collection', 'resume-info'],
    queryFn: () =>
      fetch('/api/collection/resume-info').then(r => r.json() as Promise<{ hasIncomplete: boolean; repoName?: string }>),
  });

  const { data: depthData } = useQuery({
    queryKey: ['settings', 'depth'],
    queryFn: () =>
      fetch('/api/settings/depth').then(r => r.json() as Promise<{ depthMonths: number }>),
  });

  const { data: trackedData } = useQuery({
    queryKey: ['repos', 'tracked'],
    queryFn: () =>
      fetch('/api/repos').then(r => r.json() as Promise<{ repos: TrackedRepo[] }>),
  });

  // Local optimistic depth state
  const [localDepth, setLocalDepth] = useState<number | null>(null);
  // Sync from server when data arrives
  useEffect(() => {
    if (depthData?.depthMonths && localDepth === null) {
      setLocalDepth(depthData.depthMonths);
    }
  }, [depthData, localDepth]);

  const depthMonths = localDepth ?? depthData?.depthMonths ?? 3;

  // SSE for live progress
  const { latestEvent } = useCollectionSSE({ enabled: isCollecting });

  // Track collecting state from status
  useEffect(() => {
    if (collectionStatus) {
      setIsCollecting(collectionStatus.isActive);
    }
  }, [collectionStatus]);

  // Invalidate status on batch_complete SSE event
  useEffect(() => {
    if (latestEvent?.type === 'batch_complete') {
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'resume-info'] });
    }
  }, [latestEvent, queryClient]);

  // Fetch-all dialog state
  const [showFetchAllDialog, setShowFetchAllDialog] = useState(false);

  // Collection mutations
  const startCollectionMutation = useMutation({
    mutationFn: (repoIds?: number[]) =>
      fetch('/api/collection/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoIds }),
      }).then(r => r.json()),
    onSuccess: () => {
      setIsCollecting(true);
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] });
    },
  });

  const saveDepthMutation = useMutation({
    mutationFn: (months: number) =>
      fetch('/api/settings/depth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'depth'] });
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] });
    },
  });

  const startFetchAllMutation = useMutation({
    mutationFn: () =>
      fetch('/api/collection/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fetchAll: true }),
      }).then(r => r.json()),
    onSuccess: () => {
      setIsCollecting(true);
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] });
    },
  });

  const stopCollectionMutation = useMutation({
    mutationFn: () =>
      fetch('/api/collection/stop', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => {
      setIsCollecting(false);
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] });
    },
  });

  const skipRepoMutation = useMutation({
    mutationFn: () =>
      fetch('/api/collection/skip', { method: 'POST' }).then(r => r.json()),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] }),
  });

  // Derived collection state
  const repoStatuses = collectionStatus?.repoStatuses ?? [];
  const hasTrackedRepos = (trackedData?.repos ?? []).length > 0;
  const collectingRepos = repoStatuses.filter(
    r => r.status === 'collecting' || r.status === 'updating'
  );
  const completedRepos = repoStatuses.filter(r => r.status === 'complete');
  const currentlyCollecting = collectingRepos[0] ?? null;
  const percentComplete =
    repoStatuses.length > 0
      ? Math.round((completedRepos.length / repoStatuses.length) * 100)
      : 0;

  // Build a map of repo collection statuses by fullName
  const repoStatusMap = useMemo(() => {
    const map = new Map<string, CollectionRepoStatus>();
    if (collectionStatus?.repoStatuses) {
      for (const rs of collectionStatus.repoStatuses) {
        map.set(rs.fullName, rs);
      }
    }
    return map;
  }, [collectionStatus]);

  // Depth-aware computed values
  const maxDepth = collectionStatus?.maxDepthMonths ?? 24;
  const effectiveDepth = Math.min(depthMonths, maxDepth);
  const boundaryLabel = format(
    startOfMonth(subMonths(new Date(), effectiveDepth - 1)),
    'MMMM yyyy'
  );

  // Check if any repo has fewer months collected than the depth setting
  const depthExceedsCollected = repoStatuses.some(r =>
    r.monthsCollected !== null && r.monthsCollected < effectiveDepth
  );

  // Rate limit state
  const isRateLimited =
    collectionStatus?.rateLimitResetAt != null ||
    latestEvent?.type === 'rate_limit';
  const rateLimitResetAt =
    latestEvent?.type === 'rate_limit'
      ? latestEvent.rateLimitResetAt
      : collectionStatus?.rateLimitResetAt;
  const isSecondaryRateLimit = latestEvent?.type === 'secondary_rate_limit';

  // Collection summary text
  const getCollectionSummary = () => {
    if (!hasTrackedRepos) return { heading: 'No repos tracked', body: 'Add repos to start collecting data.' };
    if (isCollecting && collectingRepos.length > 0) {
      return {
        heading: `Collecting ${completedRepos.length + 1} of ${repoStatuses.length} repos...`,
        body: undefined,
      };
    }
    if (repoStatuses.length > 0 && repoStatuses.every(r => r.status === 'complete')) {
      return { heading: 'All repos up to date', body: 'Last synced timestamps shown below.' };
    }
    return { heading: 'Ready to sync', body: 'Select repos and tap Sync now to start fetching data.' };
  };
  const summary = getCollectionSummary();

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="mx-auto max-w-3xl px-4 pt-12">
        <h1 className="text-3xl font-semibold text-foreground">Data Collection</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Fetch and cache GitHub data for your tracked repos.
        </p>

        <div className="mt-6 space-y-4">

          {/* Depth control row — per D-06, D-14 */}
          <div className="bg-muted rounded-lg px-4 py-3 mb-4 flex items-center gap-3 min-h-[44px]">
            <span className="text-sm font-semibold text-foreground">Collection depth</span>
            <input
              type="range"
              min={1}
              max={maxDepth}
              value={effectiveDepth}
              onChange={(e) => setLocalDepth(Number(e.target.value))}
              onMouseUp={() => saveDepthMutation.mutate(effectiveDepth)}
              onTouchEnd={() => saveDepthMutation.mutate(effectiveDepth)}
              onBlur={() => saveDepthMutation.mutate(effectiveDepth)}
              className="h-1.5 w-40 cursor-pointer accent-primary"
            />
            <span className="text-sm text-muted-foreground">
              Back to {boundaryLabel}
            </span>
            <span className="text-muted-foreground mx-1">|</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-sm text-muted-foreground"
              onClick={() => setShowFetchAllDialog(true)}
            >
              Fetch all history
            </Button>
          </div>

          {/* Cross-session resume banner */}
          {resumeInfo?.hasIncomplete && !isCollecting && (
            <div className="bg-muted border border-border rounded-lg p-3 flex items-center justify-between">
              <p className="text-sm text-foreground">
                Collection paused{resumeInfo.repoName ? ` \u2014 ${resumeInfo.repoName} was stopped partway through` : ''}. Resume to continue where you left off.
              </p>
              <Button
                variant="default"
                onClick={() => startCollectionMutation.mutate(undefined)}
                disabled={startCollectionMutation.isPending}
              >
                Resume collection
              </Button>
            </div>
          )}

          {/* Summary bar */}
          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-base font-semibold text-foreground">{summary.heading}</p>
                {summary.body && (
                  <p className="text-sm text-muted-foreground mt-1">{summary.body}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                {collectionStatus?.rateLimitRemaining != null && collectionStatus?.rateLimitTotal != null && (
                  <span className="text-sm text-muted-foreground">
                    {collectionStatus.rateLimitRemaining.toLocaleString()} / {collectionStatus.rateLimitTotal.toLocaleString()} API requests remaining
                  </span>
                )}
                <Button
                  onClick={() => startCollectionMutation.mutate(undefined)}
                  disabled={!hasTrackedRepos || startCollectionMutation.isPending || isCollecting}
                  className={depthExceedsCollected && !isCollecting ? 'ring-2 ring-primary ring-offset-1' : ''}
                >
                  {startCollectionMutation.isPending || isCollecting ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4 mr-2" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Sync now
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Rate-limit message */}
          {isRateLimited && rateLimitResetAt && !isSecondaryRateLimit && (
            <p className="text-sm text-muted-foreground">
              Rate limited &mdash; collection will resume after {formatResetTime(rateLimitResetAt)} automatically.
            </p>
          )}
          {isSecondaryRateLimit && (
            <p className="text-sm text-muted-foreground">
              Temporarily slowed &mdash; GitHub&apos;s secondary rate limit reached. Resuming shortly.
            </p>
          )}

          {/* Active collection progress */}
          {isCollecting && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Progress value={percentComplete} />
              </div>
              <Button
                variant="outline"
                className="text-destructive min-h-[44px]"
                onClick={() => stopCollectionMutation.mutate()}
                disabled={stopCollectionMutation.isPending}
              >
                Stop all
              </Button>
            </div>
          )}

          <Separator />

          {/* Per-repo status list */}
          {repoStatuses.length === 0 && !hasTrackedRepos && (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No repos tracked.{' '}
                <button
                  className="text-primary underline cursor-pointer"
                  onClick={() => { window.location.hash = '#/repos'; }}
                >
                  Add repos to start collecting data.
                </button>
              </p>
            </div>
          )}

          <div className="space-y-0">
            {repoStatuses.map(repo => {
              const isActiveRepo =
                currentlyCollecting?.repoId === repo.repoId;
              // Merge SSE latest event if it's for this repo
              const liveItemCount =
                latestEvent?.repoId === repo.repoId && latestEvent?.totalItemsSoFar != null
                  ? latestEvent.totalItemsSoFar
                  : null;
              const displayCommits = liveItemCount != null && latestEvent?.resourceType === 'commits'
                ? liveItemCount
                : repo.commitsCollected;
              const displayPRs = liveItemCount != null && latestEvent?.resourceType === 'pull_requests'
                ? liveItemCount
                : repo.prsCollected;

              return (
                <div
                  key={repo.repoId}
                  className="flex items-center gap-3 py-2 border-b border-border"
                >
                  {/* Status icon + repo name */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {getStatusIcon(repo.status)}
                    <span className="text-sm font-semibold truncate">{repo.name}</span>
                    <span className="text-sm text-muted-foreground truncate">
                      {repo.ownerLogin}/{repo.name}
                    </span>
                  </div>

                  {/* Items fetched */}
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {displayCommits} commits, {displayPRs} PRs
                  </span>

                  {/* Status badge */}
                  {getStatusBadge(repo.status, repo.isFirstSync, repo.monthsCollected, repo.depthMonths)}

                  {/* Last synced */}
                  {repo.lastSyncedAt && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1 whitespace-nowrap">
                      <Clock className="h-3 w-3" />
                      {new Date(repo.lastSyncedAt).toLocaleDateString()}
                    </span>
                  )}

                  {/* Per-repo sync button */}
                  {!isCollecting && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Sync ${repo.ownerLogin}/${repo.name}`}
                      onClick={() => startCollectionMutation.mutate([repo.repoId])}
                      disabled={startCollectionMutation.isPending}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}

                  {/* Skip button for actively collecting repo */}
                  {isActiveRepo && (
                    <Button
                      variant="ghost"
                      className="text-sm"
                      onClick={() => skipRepoMutation.mutate()}
                      disabled={skipRepoMutation.isPending}
                    >
                      Skip
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bot exclusion footer */}
          {collectionStatus && collectionStatus.botsExcludedCount > 0 && (
            <p className="text-sm text-muted-foreground">
              {collectionStatus.botsExcludedCount} bot account{collectionStatus.botsExcludedCount !== 1 ? 's' : ''} excluded from contributor data
            </p>
          )}

        </div>
      </div>

      {/* Fetch all history confirmation — per D-09 */}
      <AlertDialog open={showFetchAllDialog} onOpenChange={setShowFetchAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Fetch all history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will collect all commits and pull requests beyond your current depth
              setting. For large repos, this can use hundreds of API requests and may
              exhaust your GitHub rate limit for the day (5,000 requests/hour). Collection
              will pause automatically if the limit is reached.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                startFetchAllMutation.mutate();
                setShowFetchAllDialog(false);
              }}
              className="bg-primary text-primary-foreground"
            >
              Fetch all history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
