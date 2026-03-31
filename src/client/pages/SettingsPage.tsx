import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@shared/components/ui/switch';
import { Card, CardContent } from '@shared/components/ui/card';
import TokenForm from '../components/TokenForm.js';

interface Props {
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
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="mx-auto max-w-lg">
        <h1 className="text-3xl font-semibold text-foreground mb-2">Settings</h1>
        <p className="text-muted-foreground mb-8">Configure your GitHub connection.</p>

        <Card>
          <CardContent className="p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">GitHub Personal Access Token</h2>
            <TokenForm onTokenSaved={onNavigateRepos} />
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardContent className="p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">Contributor Analysis</h2>
            <div className="flex items-center justify-between">
              <div>
                <label htmlFor="bot-toggle" className="text-sm font-semibold text-foreground">
                  Include bot accounts
                </label>
                <p className="text-sm text-muted-foreground mt-1">
                  When off, accounts identified as bots (Dependabot, Renovate, GitHub Actions, and others) are excluded from all contributor data.
                </p>
              </div>
              <Switch
                id="bot-toggle"
                checked={botSettings?.includeBots ?? false}
                onCheckedChange={(checked) => botToggleMutation.mutate(checked)}
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
