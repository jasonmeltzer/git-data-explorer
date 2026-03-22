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
import type {
  GitHubRepo,
  AvailableReposResponse,
  TrackedRepo,
  RepoDeleteCounts,
} from '@shared/types.js';

export default function ReposPage() {
  const queryClient = useQueryClient();

  // Data fetching
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

  // Local state
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

  // Mutations
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

  // Save handler — adds newly selected repos AND stops repos that were tracked but unchecked
  const handleSave = async () => {
    if (!availableData) return;

    // Repos to start tracking (selected ones)
    const reposToTrack = availableData.repos.filter(r =>
      selectedGithubIds.has(r.githubId)
    );

    // Repos to stop tracking: were tracked, now deselected
    const reposToStop = (trackedData?.repos ?? []).filter(
      r => !selectedGithubIds.has(r.githubId)
    );

    // Stop deselected repos first, then save new selection
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
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl py-8 px-4">
        <h1 className="text-2xl font-semibold text-gray-900">
          Select Repos to Track
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Choose the repos you want to analyze. You can add or remove repos at any
          time.
        </p>

        {/* Search input */}
        <div className="mt-6 relative">
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
              ×
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
                  {/* Owner header */}
                  <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
                    {displayName}
                  </p>
                  {/* Select all row */}
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
                    />
                    <label
                      htmlFor={`select-all-${ownerLogin}`}
                      className="text-sm text-gray-600 cursor-pointer"
                    >
                      Select all
                    </label>
                    <span className="text-xs text-gray-400 ml-1">
                      {groupCount} / {repos.length} selected
                    </span>
                  </div>
                  {/* Repo rows */}
                  {repos.map(repo => (
                    <div
                      key={repo.githubId}
                      className="flex items-center min-h-[44px] py-2 px-1 hover:bg-gray-50 rounded"
                    >
                      <Checkbox
                        checked={selectedGithubIds.has(repo.githubId)}
                        onCheckedChange={() => toggleRepo(repo.githubId)}
                        id={`repo-${repo.githubId}`}
                      />
                      <label
                        htmlFor={`repo-${repo.githubId}`}
                        className="text-sm text-gray-900 ml-2 flex-1 cursor-pointer"
                      >
                        {repo.name}
                      </label>
                      {repo.isPrivate && (
                        <Badge variant="secondary" className="ml-2">
                          Private
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {/* Action bar */}
        <div className="mt-6 flex items-center gap-4">
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="bg-gray-900 text-white hover:bg-gray-700"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Selection'}
          </Button>
          {saveMutation.isError && (
            <p className="text-sm text-red-600">
              Failed to save repo selection. Please try again.
            </p>
          )}
          {saveMutation.isSuccess && (
            <p className="text-sm text-green-700">Selection saved.</p>
          )}
        </div>

        {/* Stopped repos panel */}
        {stoppedRepos.length > 0 && (
          <div className="mt-8">
            <button
              onClick={() => setShowStopped(v => !v)}
              className="text-sm text-gray-500 cursor-pointer hover:text-gray-700"
            >
              {stoppedRepos.length} stopped repo
              {stoppedRepos.length !== 1 ? 's' : ''}{' '}
              {showStopped ? '▲' : '▼'}
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
