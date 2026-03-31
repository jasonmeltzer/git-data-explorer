import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { TrackedRepo } from '@shared/types.js';
import { Button } from '@shared/components/ui/button';
import { Card, CardContent } from '@shared/components/ui/card';

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
    let cancelled = false;

    async function checkServer() {
      // Retry loop — server may still be starting when the frontend loads
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const r = await fetch('/api/health');
          await r.json();
          if (!cancelled) setApiStatus('ok');

          // Server is up — now check token
          try {
            const tokenRes = await fetch('/api/settings/token');
            const data = await tokenRes.json() as { configured: boolean };
            if (!cancelled) setTokenStatus(data.configured ? 'configured' : 'missing');
          } catch {
            if (!cancelled) setTokenStatus('missing');
          }
          return;
        } catch {
          // Server not ready yet — wait and retry
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      // All retries exhausted
      if (!cancelled) {
        setApiStatus('error');
        setTokenStatus('missing');
      }
    }

    checkServer();
    return () => { cancelled = true; };
  }, []);

  // Derive state from data — no racing effects
  const trackedCount = trackedData?.repos?.length ?? 0;
  const state: AppState =
    tokenStatus === 'checking' ? 'loading' :
    tokenStatus === 'missing' ? 'needs-token' :
    trackedCount > 0 ? 'has-repos' : 'no-repos';

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="max-w-md text-center px-6">
        <h1 className="text-3xl font-semibold text-foreground">Git Data Explorer</h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Understand how AI tools are changing code contribution patterns across your
          GitHub repositories.
        </p>

        {state === 'loading' && (
          <p className="mt-8 text-muted-foreground">Loading...</p>
        )}

        {state === 'needs-token' && (
          <div className="mt-8">
            <p className="text-muted-foreground mb-4">
              To get started, connect your GitHub account by adding a Personal Access
              Token.
            </p>
            <Button onClick={onNavigateSettings}>Configure GitHub Token</Button>
          </div>
        )}

        {state === 'no-repos' && (
          <div className="mt-8">
            <p className="text-sm text-muted-foreground mb-4">No repos tracked yet</p>
            <p className="text-sm text-muted-foreground mb-6">
              Add repos to start analyzing contribution patterns across your org.
            </p>
            <Button onClick={onNavigateRepos}>Add Repos</Button>
            <div className="mt-3">
              <button
                onClick={onNavigateSettings}
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                Settings
              </button>
            </div>
          </div>
        )}

        {state === 'has-repos' && (
          <div className="mt-8">
            <Card>
              <CardContent className="px-6 py-4">
                <p className="text-sm text-foreground">
                  {trackedCount} repo{trackedCount !== 1 ? 's' : ''} tracked &mdash;
                  ready to collect data
                </p>
              </CardContent>
            </Card>
            <div className="mt-4">
              <Button render={<a href="#/dashboard" />}>View Dashboard</Button>
            </div>
            <div className="mt-3 flex items-center justify-center gap-4">
              <button
                onClick={onNavigateRepos}
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                Repos
              </button>
              <button
                onClick={onNavigateSettings}
                className="text-sm text-muted-foreground hover:text-foreground underline"
              >
                Settings
              </button>
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">
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
