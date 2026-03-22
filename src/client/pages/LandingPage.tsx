import { useEffect, useState } from 'react';

interface Props {
  onNavigateSettings: () => void;
}

type AppState = 'loading' | 'needs-token' | 'ready';

export default function LandingPage({ onNavigateSettings }: Props) {
  const [state, setState] = useState<AppState>('loading');
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking');

  useEffect(() => {
    // Check API health
    fetch('/api/health')
      .then(r => r.json())
      .then(() => setApiStatus('ok'))
      .catch(() => setApiStatus('error'));

    // Check token status
    fetch('/api/settings/token')
      .then(r => r.json())
      .then(data => {
        setState(data.configured ? 'ready' : 'needs-token');
      })
      .catch(() => setState('needs-token'));
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="max-w-md text-center px-6">
        <h1 className="text-4xl font-bold text-gray-900">Git Data Explorer</h1>
        <p className="mt-3 text-lg text-gray-600">
          Understand how AI tools are changing code contribution patterns across your GitHub repositories.
        </p>

        {state === 'loading' && (
          <p className="mt-8 text-gray-400">Loading...</p>
        )}

        {state === 'needs-token' && (
          <div className="mt-8">
            <p className="text-gray-600 mb-4">
              To get started, connect your GitHub account by adding a Personal Access Token.
            </p>
            <button
              onClick={onNavigateSettings}
              className="inline-flex items-center rounded-md bg-gray-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            >
              Configure GitHub Token
            </button>
          </div>
        )}

        {state === 'ready' && (
          <div className="mt-8">
            <p className="text-gray-500 mb-4">
              No repos tracked yet -- add repos to get started.
            </p>
            <button
              onClick={onNavigateSettings}
              className="text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Settings
            </button>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400">
          API: {apiStatus === 'checking' ? 'checking...' : apiStatus === 'ok' ? 'connected' : 'unreachable'}
        </p>
      </div>
    </div>
  );
}
