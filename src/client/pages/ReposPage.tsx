import { useState, useMemo, useEffect } from 'react';
import { startOfMonth, subMonths, format } from 'date-fns';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Badge } from '@shared/components/ui/badge';
import { Input } from '@shared/components/ui/input';
import { Button } from '@shared/components/ui/button';
// Tabs removed — using simple hand-rolled tabs for reliability
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
  GitHubRepo,
  AvailableReposResponse,
  TrackedRepo,
  RepoDeleteCounts,
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

function getReposTabBadge(status: CollectionRepoOverallStatus | undefined) {
  if (!status) return null;
  switch (status) {
    case 'collecting':
    case 'updating':
      return <Badge variant="secondary">Collecting...</Badge>;
    case 'paused':
      return <Badge variant="secondary">Stopped</Badge>;
    case 'error':
      return (
        <Badge variant="outline" className="text-destructive border-destructive">
          Error
        </Badge>
      );
    default:
      return null;
  }
}

function formatResetTime(resetAt: string): string {
  return new Date(resetAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReposPage() {
  const queryClient = useQueryClient();

  // Data fetching — repos
  // Check token status first — don't hit GitHub API without a valid token
  const { data: tokenData } = useQuery({
    queryKey: ['settings', 'token'],
    queryFn: () =>
      fetch('/api/settings/token').then(r => r.json() as Promise<{ configured: boolean }>),
  });

  const {
    data: availableData,
    isLoading: loadingAvailable,
    error: availableError,
  } = useQuery({
    queryKey: ['repos', 'available'],
    queryFn: () =>
      fetch('/api/repos/available').then(r => {
        if (!r.ok)
          throw new Error(r.status === 401 ? 'token-missing' : 'api-error');
        return r.json() as Promise<AvailableReposResponse>;
      }),
    enabled: tokenData?.configured === true,
  });

  const { data: trackedData } = useQuery({
    queryKey: ['repos', 'tracked'],
    queryFn: () =>
      fetch('/api/repos').then(r => r.json() as Promise<{ repos: TrackedRepo[] }>),
  });

  const { data: stoppedData } = useQuery({
    queryKey: ['repos', 'stopped'],
    queryFn: () =>
      fetch('/api/repos/stopped').then(
        r => r.json() as Promise<{ repos: TrackedRepo[] }>
      ),
  });

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

  // Tabs
  const [activeTab, setActiveTab] = useState<'repos' | 'collection'>('repos');

  // Local state — repos tab
  const [selectedGithubIds, setSelectedGithubIds] = useState<Set<number>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TrackedRepo | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<RepoDeleteCounts | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [stoppingIds, setStoppingIds] = useState<Set<number>>(new Set());
  const [showFetchAllDialog, setShowFetchAllDialog] = useState(false);

  // Initialize selection from tracked repos
  useEffect(() => {
    if (trackedData?.repos) {
      setSelectedGithubIds(new Set(trackedData.repos.map(r => r.githubId)));
    }
  }, [trackedData]);

  // Repo mutations
  const saveMutation = useMutation({
    mutationFn: (repos: GitHubRepo[]) =>
      fetch('/api/repos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repos }),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/repos/${id}/stop`, { method: 'PATCH' }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repos'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/repos/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      setDeleteTarget(null);
      setDeleteCounts(null);
    },
  });

  // Filtered and grouped repos
  const filteredRepos = useMemo(() => {
    if (!availableData) return [];
    const query = searchQuery.toLowerCase();
    return availableData.repos.filter(
      r =>
        !query ||
        r.fullName.toLowerCase().includes(query) ||
        r.name.toLowerCase().includes(query)
    );
  }, [availableData, searchQuery]);

  const groupedRepos = useMemo(() => {
    const groups = new Map<string, GitHubRepo[]>();
    const authLogin = availableData?.authenticatedLogin ?? '';

    const sorted = [...filteredRepos].sort((a, b) => {
      if (a.ownerLogin === authLogin && b.ownerLogin !== authLogin) return -1;
      if (b.ownerLogin === authLogin && a.ownerLogin !== authLogin) return 1;
      return a.ownerLogin.localeCompare(b.ownerLogin);
    });

    for (const repo of sorted) {
      const key = repo.ownerLogin;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(repo);
    }
    return groups;
  }, [filteredRepos, availableData?.authenticatedLogin]);

  // Build a map of repo collection statuses by githubId for the Repos tab badges
  const repoStatusMap = useMemo(() => {
    const map = new Map<string, CollectionRepoStatus>();
    if (collectionStatus?.repoStatuses) {
      for (const rs of collectionStatus.repoStatuses) {
        map.set(rs.fullName, rs);
      }
    }
    return map;
  }, [collectionStatus]);

  // Selection helpers
  const toggleRepo = (githubId: number) => {
    setSelectedGithubIds(prev => {
      const next = new Set(prev);
      if (next.has(githubId)) {
        next.delete(githubId);
      } else {
        next.add(githubId);
      }
      return next;
    });
  };

  const toggleGroup = (ownerLogin: string) => {
    const repos = groupedRepos.get(ownerLogin) ?? [];
    const allSelected = repos.every(r => selectedGithubIds.has(r.githubId));
    setSelectedGithubIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        repos.forEach(r => next.delete(r.githubId));
      } else {
        repos.forEach(r => next.add(r.githubId));
      }
      return next;
    });
  };

  const isGroupAllSelected = (ownerLogin: string) => {
    const repos = groupedRepos.get(ownerLogin) ?? [];
    return repos.length > 0 && repos.every(r => selectedGithubIds.has(r.githubId));
  };

  const isGroupPartiallySelected = (ownerLogin: string) => {
    const repos = groupedRepos.get(ownerLogin) ?? [];
    const selectedCount = repos.filter(r => selectedGithubIds.has(r.githubId)).length;
    return selectedCount > 0 && selectedCount < repos.length;
  };

  // Save handler
  const handleSave = async () => {
    if (!availableData) return;
    const reposToTrack = availableData.repos.filter(r =>
      selectedGithubIds.has(r.githubId)
    );
    const reposToStop = (trackedData?.repos ?? []).filter(
      r => !selectedGithubIds.has(r.githubId)
    );
    await Promise.all(reposToStop.map(r => stopMutation.mutateAsync(r.id)));
    saveMutation.mutate(reposToTrack);
  };

  // Stop tracking handler
  const handleStop = async (repo: TrackedRepo) => {
    setStoppingIds(prev => new Set(prev).add(repo.id));
    try {
      await stopMutation.mutateAsync(repo.id);
    } finally {
      setStoppingIds(prev => {
        const next = new Set(prev);
        next.delete(repo.id);
        return next;
      });
    }
  };

  // Delete data flow
  const handleDeleteClick = async (repo: TrackedRepo) => {
    setDeleteTarget(repo);
    const counts = await fetch(`/api/repos/${repo.id}/delete-preview`).then(
      r => r.json() as Promise<RepoDeleteCounts>
    );
    setDeleteCounts(counts);
  };

  // Re-add repo
  const handleReAdd = (repo: TrackedRepo) => {
    const repoAsGitHub: GitHubRepo = {
      githubId: repo.githubId,
      fullName: repo.fullName,
      name: repo.name,
      ownerLogin: repo.ownerLogin,
      isPrivate: repo.isPrivate,
      defaultBranch: repo.defaultBranch,
    };
    saveMutation.mutate([repoAsGitHub]);
  };

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

  // Depth-aware computed values
  const maxDepth = collectionStatus?.maxDepthMonths ?? 24;
  const boundaryLabel = format(
    startOfMonth(subMonths(new Date(), depthMonths - 1)),
    'MMMM yyyy'
  );

  // Check if any repo has fewer months collected than the depth setting
  const depthExceedsCollected = repoStatuses.some(r =>
    r.monthsCollected !== null && r.monthsCollected < depthMonths
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

  // Token missing error state
  const errorMessage =
    availableError instanceof Error ? availableError.message : null;

  if (errorMessage === 'token-missing') {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-gray-600 mb-4">
            GitHub token required to load repos.
          </p>
          <Button
            onClick={() => {
              window.location.hash = '#/settings';
            }}
          >
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  if (loadingAvailable) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm text-gray-400">Loading your repos from GitHub...</p>
        </div>
      </div>
    );
  }

  if (tokenData && !tokenData.configured) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-gray-600 mb-4">
            GitHub token not configured. Add your token in Settings to load repos.
          </p>
          <Button variant="outline" onClick={() => { window.location.hash = '#settings'; }}>
            Go to Settings
          </Button>
        </div>
      </div>
    );
  }

  if (availableError) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-gray-600 mb-4">
            Could not load repos from GitHub. Check your connection and try again.
          </p>
          <Button
            variant="outline"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ['repos', 'available'] })
            }
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const authLogin = availableData?.authenticatedLogin ?? '';
  const stoppedRepos = stoppedData?.repos ?? [];
  const groupEntries = Array.from(groupedRepos.entries());

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="mx-auto max-w-2xl py-8 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">
          Select Repos to Track
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Choose the repos you want to analyze. You can add or remove repos at any
          time.
        </p>

        <div className="mt-6">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
            <button
              onClick={() => setActiveTab('repos')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'repos'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Repos
            </button>
            <button
              onClick={() => setActiveTab('collection')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'collection'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Collection
            </button>
          </div>

          {/* ====== REPOS TAB ====== */}
          {activeTab === 'repos' && (<>
            <div className="mt-4 relative">
              <Input
                placeholder="Filter repos by name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pr-8"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear search"
                >
                  x
                </button>
              )}
            </div>

            {/* Rate-limit warning */}
            {selectedGithubIds.size > 5 && (
              <div className="mt-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                Selecting many repos may take multiple sessions due to GitHub API rate
                limits. We recommend starting with 5 or fewer.
              </div>
            )}

            {/* Repo groups */}
            {searchQuery && groupEntries.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center">
                No repos match &ldquo;{searchQuery}&rdquo;
              </p>
            ) : (
              <div className="mt-4 space-y-6">
                {groupEntries.map(([ownerLogin, repos], index) => {
                  const groupCount = repos.filter(r =>
                    selectedGithubIds.has(r.githubId)
                  ).length;
                  const allSelected = isGroupAllSelected(ownerLogin);
                  const partialSelected = isGroupPartiallySelected(ownerLogin);
                  const displayName =
                    ownerLogin === authLogin ? 'Personal' : ownerLogin;

                  return (
                    <div key={ownerLogin}>
                      {index > 0 && <div className="border-t border-gray-100 mb-4" />}
                      <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                        {displayName}
                      </p>
                      <div className="flex items-center gap-2 mb-1 py-1">
                        <Checkbox
                          checked={allSelected}
                          data-state={
                            partialSelected
                              ? 'indeterminate'
                              : allSelected
                              ? 'checked'
                              : 'unchecked'
                          }
                          onCheckedChange={() => toggleGroup(ownerLogin)}
                          id={`select-all-${ownerLogin}`}
                          className="shrink-0 min-w-5"
                        />
                        <label
                          htmlFor={`select-all-${ownerLogin}`}
                          className="text-sm text-gray-600 cursor-pointer ml-3"
                        >
                          {allSelected ? 'Unselect all' : 'Select all'}
                        </label>
                        <span className="text-xs text-gray-400 ml-1">
                          {groupCount} / {repos.length} selected
                        </span>
                      </div>
                      {repos.map(repo => {
                        const repoCollectionStatus = repoStatusMap.get(repo.fullName);
                        const collectionBadge = repoCollectionStatus
                          ? getReposTabBadge(repoCollectionStatus.status)
                          : null;
                        return (
                          <div
                            key={repo.githubId}
                            className="flex items-center min-h-[44px] py-2 px-1 hover:bg-gray-50 rounded"
                          >
                            <Checkbox
                              checked={selectedGithubIds.has(repo.githubId)}
                              onCheckedChange={() => toggleRepo(repo.githubId)}
                              id={`repo-${repo.githubId}`}
                              className="shrink-0 min-w-5"
                            />
                            <label
                              htmlFor={`repo-${repo.githubId}`}
                              className="text-sm text-gray-900 ml-3 flex-1 cursor-pointer"
                            >
                              {repo.name}
                            </label>
                            {collectionBadge}
                            {repoCollectionStatus?.lastSyncedAt && (
                              <span className="text-xs text-muted-foreground ml-2 flex items-center gap-1">
                                <Clock className="h-3 w-3 inline" />
                                {new Date(repoCollectionStatus.lastSyncedAt).toLocaleDateString()}
                              </span>
                            )}
                            {repo.isPrivate && (
                              <Badge variant="secondary" className="ml-2">
                                Private
                              </Badge>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Stopped repos panel */}
            {stoppedRepos.length > 0 && (
              <div className="mt-8">
                <button
                  onClick={() => setShowStopped(v => !v)}
                  className="text-sm text-gray-500 cursor-pointer hover:text-gray-700"
                >
                  {stoppedRepos.length} stopped repo
                  {stoppedRepos.length !== 1 ? 's' : ''}{' '}
                  {showStopped ? '\u25B2' : '\u25BC'}
                </button>

                {showStopped && (
                  <div className="mt-3 space-y-2">
                    {stoppedRepos.map(repo => (
                      <div
                        key={repo.id}
                        className="flex items-center gap-2 py-1"
                      >
                        <span className="text-sm text-gray-500 flex-1">
                          {repo.fullName}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReAdd(repo)}
                          disabled={saveMutation.isPending}
                        >
                          Re-add repo
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => handleDeleteClick(repo)}
                        >
                          Delete data
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tracked repos with stop tracking action */}
            {trackedData && trackedData.repos.length > 0 && (
              <div className="mt-8">
                <p className="text-sm font-semibold text-gray-700 mb-2">
                  Currently tracked
                </p>
                <div className="space-y-1">
                  {trackedData.repos.map(repo => (
                    <div
                      key={repo.id}
                      className="flex items-center gap-2 min-h-[44px] py-2 px-1"
                    >
                      <span className="text-sm text-gray-900 flex-1">
                        {repo.fullName}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleStop(repo)}
                        disabled={stoppingIds.has(repo.id)}
                        className="text-gray-500 hover:text-gray-700"
                      >
                        {stoppingIds.has(repo.id) ? 'Stopping...' : 'Stop tracking'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>)}

          {/* ====== COLLECTION TAB ====== */}
          {activeTab === 'collection' && (
            <div className="mt-4 space-y-4">
              {/* Depth control row — per D-06, D-14 */}
              <div className="bg-muted rounded-lg px-4 py-3 mb-4 flex items-center gap-3 min-h-[44px]">
                <span className="text-sm font-semibold text-foreground">Collection depth</span>
                <input
                  type="range"
                  min={1}
                  max={maxDepth}
                  value={Math.min(depthMonths, maxDepth)}
                  onChange={(e) => setLocalDepth(Number(e.target.value))}
                  onMouseUp={() => saveDepthMutation.mutate(depthMonths)}
                  onTouchEnd={() => saveDepthMutation.mutate(depthMonths)}
                  onBlur={() => saveDepthMutation.mutate(depthMonths)}
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
                      onClick={() => setActiveTab('repos')}
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
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-gray-200 bg-white px-4 py-3 shadow-md">
        <div className="mx-auto max-w-2xl flex items-center gap-4">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || stopMutation.isPending}
            className="bg-gray-900 text-white hover:bg-gray-700"
          >
            {saveMutation.isPending || stopMutation.isPending
              ? 'Saving...'
              : 'Save Selection'}
          </Button>
          {selectedGithubIds.size > 0 && (
            <button
              onClick={() => setSelectedGithubIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Unselect all
            </button>
          )}
          {saveMutation.isError && (
            <p className="text-sm text-red-600">
              Failed to save. Please try again.
            </p>
          )}
          {saveMutation.isSuccess && !saveMutation.isPending && (
            <p className="text-sm text-green-700">Selection saved.</p>
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

      {/* Delete confirmation dialog */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={open => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteCounts(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete all data for {deleteTarget?.fullName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCounts
                ? `This will permanently delete ${deleteCounts.commits} commits and ${deleteCounts.prs} pull requests from your local database. This action cannot be undone.`
                : 'Loading data counts...'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteTarget(null);
                setDeleteCounts(null);
              }}
            >
              Keep data
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending || !deleteCounts}
              onClick={() => {
                if (deleteTarget) {
                  deleteMutation.mutate(deleteTarget.id);
                }
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
