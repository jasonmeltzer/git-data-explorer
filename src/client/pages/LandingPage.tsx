import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TrackedRepo } from '@shared/types.js';

interface Props {
  onNavigateSettings: () => void;
  onNavigateRepos: () => void;
}

type AppState = 'loading' | 'needs-token' | 'no-repos' | 'has-repos';

export default function LandingPage({ onNavigateSettings, onNavigateRepos }: Props) {
  const [tokenStatus, setTokenStatus] = useState<'checking' | 'configured' | 'missing'>('checking');
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking');

  // Fetch tracked repos via TanStack Query to share cache with ReposPage.
  const { data: trackedData } = useQuery({
    queryKey: ['repos', 'tracked'],
    queryFn: () =>
      fetch('/api/repos').then(r => r.json() as Promise<{ repos: TrackedRepo[] }>),
  });

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(() => setApiStatus('ok'))
      .catch(() => setApiStatus('error'));

    fetch('/api/settings/token')
      .then(r => r.json())
      .then((data: { configured: boolean }) => {
        setTokenStatus(data.configured ? 'configured' : 'missing');
      })
      .catch(() => setTokenStatus('missing'));
  }, []);

  // Derive state from data — no racing effects
  const trackedCount = trackedData?.repos?.length ?? 0;
  const state: AppState =
    tokenStatus === 'checking' ? 'loading' :
    tokenStatus === 'missing' ? 'needs-token' :
    trackedCount > 0 ? 'has-repos' : 'no-repos';

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md text-center px-6">
        <h1 className="text-4xl font-bold text-gray-900">Git Data Explorer</h1>
        <p className="mt-3 text-lg text-gray-600">
          Understand how AI tools are changing code contribution patterns across your
          GitHub repositories.
        </p>

        {state === 'loading' && (
          <p className="mt-8 text-gray-400">Loading...</p>
        )}

        {state === 'needs-token' && (
          <div className="mt-8">
            <p className="text-gray-600 mb-4">
              To get started, connect your GitHub account by adding a Personal Access
              Token.
            </p>
            <button
              onClick={onNavigateSettings}
              className="inline-flex items-center rounded-md bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              Configure GitHub Token
            </button>
          </div>
        )}

        {state === 'no-repos' && (
          <div className="mt-8">
            <p className="text-sm text-gray-500 mb-4">No repos tracked yet</p>
            <p className="text-sm text-gray-500 mb-6">
              Add repos to start analyzing contribution patterns across your org.
            </p>
            <button
              onClick={onNavigateRepos}
              className="inline-flex items-center rounded-md bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              Add Repos
            </button>
            <div className="mt-3">
              <button
                onClick={onNavigateSettings}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                Settings
              </button>
            </div>
          </div>
        )}

        {state === 'has-repos' && (
          <div className="mt-8">
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
              <p className="text-sm text-gray-700">
                {trackedCount} repo{trackedCount !== 1 ? 's' : ''} tracked &mdash;
                ready to collect data
              </p>
            </div>
            <button
              onClick={onNavigateRepos}
              className="mt-4 inline-flex items-center rounded-md bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              Go to Repos
            </button>
            <div className="mt-3">
              <button
                onClick={onNavigateSettings}
                className="text-sm text-gray-400 hover:text-gray-600 underline"
              >
                Settings
              </button>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400">
          API:{' '}
          {apiStatus === 'checking'
            ? 'checking...'
            : apiStatus === 'ok'
            ? 'connected'
            : 'unreachable'}
        </p>
      </div>
    </div>
  );
}
