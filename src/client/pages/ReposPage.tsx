import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Badge } from '@shared/components/ui/badge';
import { Input } from '@shared/components/ui/input';
import { Button } from '@shared/components/ui/button';
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
  Clock,
} from 'lucide-react';
import type {
  GitHubRepo,
  AvailableReposResponse,
  TrackedRepo,
  RepoDeleteCounts,
  CollectionBatchStatus,
  CollectionRepoStatus,
  CollectionRepoOverallStatus,
} from '@shared/types.js';

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

export default function ReposPage() {
  const queryClient = useQueryClient();

  // Data fetching — repos
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

  // Data fetching — collection status for per-repo badges
  const [isCollecting, setIsCollecting] = useState(false);

  const { data: collectionStatus } = useQuery({
    queryKey: ['collection', 'status'],
    queryFn: () =>
      fetch('/api/collection/status').then(r => r.json() as Promise<CollectionBatchStatus>),
    refetchInterval: isCollecting ? 3000 : 30000,
  });

  // Track collecting state from status
  useEffect(() => {
    if (collectionStatus) {
      setIsCollecting(collectionStatus.isActive);
    }
  }, [collectionStatus]);

  // Local state — repos
  const [selectedGithubIds, setSelectedGithubIds] = useState<Set<number>>(
    new Set()
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<TrackedRepo | null>(null);
  const [deleteCounts, setDeleteCounts] = useState<RepoDeleteCounts | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const [stoppingIds, setStoppingIds] = useState<Set<number>>(new Set());

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
      queryClient.invalidateQueries({ queryKey: ['collection', 'status'] });
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

  // Build a map of repo collection statuses by fullName for per-repo badges
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

  // Token missing error state
  const errorMessage =
    availableError instanceof Error ? availableError.message : null;

  if (errorMessage === 'token-missing') {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-muted-foreground mb-4">
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
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm text-muted-foreground">Loading your repos from GitHub...</p>
        </div>
      </div>
    );
  }

  if (tokenData && !tokenData.configured) {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-muted-foreground mb-4">
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
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="mx-auto max-w-2xl">
          <p className="text-sm text-muted-foreground mb-4">
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
    <div className="min-h-screen bg-background pb-24">
      <div className="mx-auto max-w-2xl py-8 px-4">
        <h1 className="text-3xl font-semibold text-foreground">
          Select Repos to Track
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the repos you want to analyze. You can add or remove repos at any
          time.
        </p>

        <div className="mt-6">
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
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
            <p className="text-sm text-muted-foreground py-8 text-center">
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
                    {index > 0 && <div className="border-t border-border mb-4" />}
                    <p className="text-sm font-semibold text-foreground uppercase tracking-wide mb-2">
                      {displayName}
                    </p>
                    <div
                      className="flex items-center gap-2 mb-1 py-1 cursor-pointer"
                      onClick={() => toggleGroup(ownerLogin)}
                    >
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
                        className="shrink-0 min-w-5"
                      />
                      <span
                        className="text-sm text-muted-foreground ml-3"
                      >
                        {allSelected ? 'Unselect all' : 'Select all'}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">
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
                          className="flex items-center min-h-[44px] py-2 px-1 hover:bg-muted rounded cursor-pointer"
                          onClick={() => toggleRepo(repo.githubId)}
                        >
                          <Checkbox
                            checked={selectedGithubIds.has(repo.githubId)}
                            onCheckedChange={() => toggleRepo(repo.githubId)}
                            className="shrink-0 min-w-5"
                          />
                          <span
                            className="text-sm text-foreground ml-3 flex-1"
                          >
                            {repo.name}
                          </span>
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
                className="text-sm text-muted-foreground cursor-pointer hover:text-foreground"
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
                      <span className="text-sm text-muted-foreground flex-1">
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
              <p className="text-sm font-semibold text-foreground mb-2">
                Currently tracked
              </p>
              <div className="space-y-1">
                {trackedData.repos.map(repo => (
                  <div
                    key={repo.id}
                    className="flex items-center gap-2 min-h-[44px] py-2 px-1"
                  >
                    <span className="text-sm text-foreground flex-1">
                      {repo.fullName}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStop(repo)}
                      disabled={stoppingIds.has(repo.id)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {stoppingIds.has(repo.id) ? 'Stopping...' : 'Stop tracking'}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-border bg-card px-4 py-3 shadow-md">
        <div className="mx-auto max-w-2xl flex items-center gap-4">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || stopMutation.isPending}
          >
            {saveMutation.isPending || stopMutation.isPending
              ? 'Saving...'
              : 'Save Selection'}
          </Button>
          {selectedGithubIds.size > 0 && (
            <button
              onClick={() => setSelectedGithubIds(new Set())}
              className="text-sm text-muted-foreground hover:text-foreground underline"
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
