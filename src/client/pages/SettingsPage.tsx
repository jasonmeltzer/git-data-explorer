import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Switch } from '@shared/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card';
import { Input } from '@shared/components/ui/input';
import { Button } from '@shared/components/ui/button';
import TokenForm from '../components/TokenForm.js';
import { useCohortConfig } from '../hooks/useCohortConfig.js';
import { DEFAULT_COHORT_CONFIG } from '@shared/cohort-config.js';

interface Props {
  onNavigateRepos: () => void;
}

export default function SettingsPage({ onNavigateRepos }: Props) {
  const queryClient = useQueryClient();

  // --- Bot toggle ---
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

  // --- Cohort config ---
  const { config, isLoading: isConfigLoading, saveConfig, isSaving } = useCohortConfig();

  const defaults = DEFAULT_COHORT_CONFIG;

  const [t1Months, setT1Months] = useState<string>(String(defaults.thresholds[0].maxMonths ?? 3));
  const [t2Months, setT2Months] = useState<string>(String(defaults.thresholds[1].maxMonths ?? 12));
  const [t1Label, setT1Label] = useState<string>(defaults.thresholds[0].label);
  const [t2Label, setT2Label] = useState<string>(defaults.thresholds[1].label);
  const [seniorLabel, setSeniorLabel] = useState<string>(defaults.thresholds[2].label);

  const [t1Error, setT1Error] = useState<string>('');
  const [t2Error, setT2Error] = useState<string>('');
  const [t1LabelError, setT1LabelError] = useState<string>('');
  const [t2LabelError, setT2LabelError] = useState<string>('');
  const [seniorLabelError, setSeniorLabelError] = useState<string>('');
  const [showSaved, setShowSaved] = useState(false);

  // Sync form fields from loaded config
  useEffect(() => {
    if (config) {
      setT1Months(String(config.thresholds[0].maxMonths ?? 3));
      setT2Months(String(config.thresholds[1].maxMonths ?? 12));
      setT1Label(config.thresholds[0].label);
      setT2Label(config.thresholds[1].label);
      setSeniorLabel(config.thresholds[2].label);
    }
  }, [config]);

  function validate(): boolean {
    let valid = true;
    const v1 = parseInt(t1Months, 10);
    const v2 = parseInt(t2Months, 10);

    if (!Number.isInteger(v1) || v1 < 1) {
      setT1Error('Must be a positive whole number');
      valid = false;
    } else {
      setT1Error('');
    }

    if (!Number.isInteger(v2) || v2 < 2) {
      setT2Error('Must be a whole number of at least 2');
      valid = false;
    } else {
      setT2Error('');
    }

    if (valid && v1 >= v2) {
      setT1Error('Must be less than Threshold 2');
      valid = false;
    }

    if (!t1Label.trim()) {
      setT1LabelError('Label cannot be empty');
      valid = false;
    } else {
      setT1LabelError('');
    }

    if (!t2Label.trim()) {
      setT2LabelError('Label cannot be empty');
      valid = false;
    } else {
      setT2LabelError('');
    }

    if (!seniorLabel.trim()) {
      setSeniorLabelError('Label cannot be empty');
      valid = false;
    } else {
      setSeniorLabelError('');
    }

    return valid;
  }

  async function handleSaveCohortConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const current = config ?? defaults;
    await saveConfig({
      thresholds: [
        { ...current.thresholds[0], maxMonths: parseInt(t1Months, 10), label: t1Label.trim() },
        { ...current.thresholds[1], maxMonths: parseInt(t2Months, 10), label: t2Label.trim() },
        { ...current.thresholds[2], maxMonths: null, label: seniorLabel.trim() },
      ],
    });

    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  }

  function handleReset() {
    setT1Months(String(defaults.thresholds[0].maxMonths ?? 3));
    setT2Months(String(defaults.thresholds[1].maxMonths ?? 12));
    setT1Label(defaults.thresholds[0].label);
    setT2Label(defaults.thresholds[1].label);
    setSeniorLabel(defaults.thresholds[2].label);
    setT1Error('');
    setT2Error('');
    setT1LabelError('');
    setT2LabelError('');
    setSeniorLabelError('');
  }

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

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Cohort Boundaries</CardTitle>
            <p className="text-sm text-muted-foreground">Define tenure thresholds and labels for your org's ramp-up expectations.</p>
          </CardHeader>
          <CardContent>
            {isConfigLoading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : (
              <form onSubmit={handleSaveCohortConfig} className="space-y-4">
                <p className="text-xs text-muted-foreground">Threshold 1 separates "new" from "growing" contributors. Threshold 2 separates "growing" from "senior". Threshold 1 must be less than Threshold 2.</p>

                {/* Threshold 1 row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Threshold 1 (months)</label>
                    <Input
                      type="number"
                      min={1}
                      value={t1Months}
                      onChange={e => setT1Months(e.target.value)}
                    />
                    {t1Error && <p className="text-xs text-destructive mt-1">{t1Error}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Label</label>
                    <Input
                      type="text"
                      maxLength={20}
                      value={t1Label}
                      onChange={e => setT1Label(e.target.value)}
                    />
                    {t1LabelError && <p className="text-xs text-destructive mt-1">{t1LabelError}</p>}
                  </div>
                </div>

                {/* Threshold 2 row */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Threshold 2 (months)</label>
                    <Input
                      type="number"
                      min={2}
                      value={t2Months}
                      onChange={e => setT2Months(e.target.value)}
                    />
                    {t2Error && <p className="text-xs text-destructive mt-1">{t2Error}</p>}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Label</label>
                    <Input
                      type="text"
                      maxLength={20}
                      value={t2Label}
                      onChange={e => setT2Label(e.target.value)}
                    />
                    {t2LabelError && <p className="text-xs text-destructive mt-1">{t2LabelError}</p>}
                  </div>
                </div>

                {/* Senior label row */}
                <div className="grid grid-cols-2 gap-4">
                  <div /> {/* empty space */}
                  <div>
                    <label className="text-sm font-medium">Senior Label</label>
                    <Input
                      type="text"
                      maxLength={20}
                      value={seniorLabel}
                      onChange={e => setSeniorLabel(e.target.value)}
                    />
                    {seniorLabelError && <p className="text-xs text-destructive mt-1">{seniorLabelError}</p>}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-4">
                  <Button type="submit" disabled={isSaving}>Save Cohort Config</Button>
                  <Button type="button" variant="outline" onClick={handleReset}>Reset to Defaults</Button>
                  {showSaved && <span className="text-sm text-muted-foreground">Saved</span>}
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
