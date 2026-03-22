import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@shared/components/ui/switch';
import TokenForm from '../components/TokenForm.js';

interface Props {
  onBack: () => void;
  onNavigateRepos: () => void;
}

export default function SettingsPage({ onNavigateRepos }: Props) {
  const queryClient = useQueryClient();

  const { data: botSettings } = useQuery({
    queryKey: ['settings', 'bots'],
    queryFn: () =>
      fetch('/api/settings/bots').then(r => r.json() as Promise<{ includeBots: boolean }>),
  });

  const botToggleMutation = useMutation({
    mutationFn: (includeBots: boolean) =>
      fetch('/api/settings/bots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeBots }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'bots'] }),
  });

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Settings</h1>
        <p className="text-gray-600 mb-8">Configure your GitHub connection.</p>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">GitHub Personal Access Token</h2>
          <TokenForm onTokenSaved={onNavigateRepos} />
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm mt-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Contributor Analysis</h2>
          <div className="flex items-center justify-between">
            <div>
              <label htmlFor="bot-toggle" className="text-sm font-semibold text-gray-900">
                Include bot accounts
              </label>
              <p className="text-sm text-muted-foreground mt-1">
                When off, accounts identified as bots (Dependabot, Renovate, GitHub Actions, and others) are excluded from all contributor data.
              </p>
            </div>
            <Switch
              id="bot-toggle"
              checked={botSettings?.includeBots ?? false}
              onCheckedChange={(checked: boolean) => botToggleMutation.mutate(checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
