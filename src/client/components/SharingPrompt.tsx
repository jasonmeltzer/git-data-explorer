import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@shared/components/ui/alert-dialog.js';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import { Badge } from '@shared/components/ui/badge.js';
import { Button } from '@shared/components/ui/button.js';
import { useDeclineSharing, useMarkPromptShown } from '../hooks/useSharingStatus.js';
import type { ExportBundle } from '@shared/export-types.js';

interface SharingPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exportBundle: ExportBundle | null;
}

type ShareTier = 'summary' | 'full';
type ShareDestination = 'http' | 'gist' | 'manual';

interface ShareResult {
  success: boolean;
  gistUrl?: string;
  error?: string;
}

function prepareShareData(bundle: ExportBundle, tier: ShareTier): object {
  // Sharing always uses the already-anonymized export bundle
  if (tier === 'summary') {
    return {
      metadata: bundle.metadata,
      executiveSummary: bundle.executiveSummary,
      rolling: bundle.rolling,
    };
  }
  return bundle;
}

export default function SharingPrompt({ open, onOpenChange, exportBundle }: SharingPromptProps) {
  const [tier, setTier] = useState<ShareTier>('summary');
  const [destination, setDestination] = useState<ShareDestination>('manual');
  const [httpReachable, setHttpReachable] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const [lastDestination, setLastDestination] = useState<ShareDestination | null>(null);

  const declineMutation = useDeclineSharing();
  const markShownMutation = useMarkPromptShown();

  // Check HTTP reachability and mark prompt shown when dialog opens
  useEffect(() => {
    if (!open) return;

    markShownMutation.mutate();

    fetch('/api/share/reachability')
      .then((res) => res.json())
      .then((data: { reachable: boolean }) => {
        setHttpReachable(data.reachable);
      })
      .catch(() => {
        setHttpReachable(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setTier('summary');
      setDestination('manual');
      setSharing(false);
      setShareResult(null);
      setLastDestination(null);
    }
  }, [open]);

  async function handleShare() {
    if (!exportBundle) return;

    setSharing(true);
    setShareResult(null);
    setLastDestination(destination);

    const shareData = prepareShareData(exportBundle, tier);

    try {
      if (destination === 'gist') {
        const res = await fetch('/api/share/gist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier, data: shareData }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Gist creation failed' }));
          throw new Error((err as { error?: string }).error || 'Gist creation failed');
        }
        const result = await res.json() as { gistUrl: string };
        setShareResult({ success: true, gistUrl: result.gistUrl });
      } else if (destination === 'http') {
        const res = await fetch('/api/share/http', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: shareData }),
        });
        if (!res.ok) throw new Error('HTTP share failed');
        setShareResult({ success: true });
      } else {
        // Manual download — clean JSON sharing package (distinct from the export ZIP)
        const blob = new Blob([JSON.stringify(shareData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gde-sharing-package-${tier}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setShareResult({ success: true });
      }
    } catch (err) {
      setShareResult({
        success: false,
        error: err instanceof Error ? err.message : 'An error occurred. Please try again.',
      });
    } finally {
      setSharing(false);
    }
  }

  function handleDecline() {
    declineMutation.mutate();
    onOpenChange(false);
  }

  const previewData = exportBundle ? prepareShareData(exportBundle, tier) : null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Help advance AI adoption research?</AlertDialogTitle>
          <AlertDialogDescription>
            You've collected meaningful data. Sharing an anonymized version helps researchers
            understand how AI tools are changing engineering workflows.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!shareResult?.success ? (
          <div className="space-y-4">
            {/* Tier selector */}
            <div>
              <p className="text-sm font-medium mb-2">What to share</p>
              <div className="grid grid-cols-2 gap-4">
                {/* Summary card */}
                <Card
                  role="radio"
                  aria-checked={tier === 'summary'}
                  tabIndex={0}
                  onClick={() => setTier('summary')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTier('summary'); }}
                  className={[
                    'cursor-pointer transition-colors',
                    tier === 'summary' ? 'border-primary ring-1 ring-primary' : 'hover:border-muted-foreground',
                  ].join(' ')}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      Summary Report
                      <Badge variant="secondary" className="text-[10px]">Recommended</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    <p>Aggregate stats only — no individual rows.</p>
                    <ul className="mt-1 space-y-0.5 list-disc list-inside">
                      <li>Executive summary KPIs</li>
                      <li>Rolling trend metrics</li>
                      <li>Export metadata</li>
                    </ul>
                  </CardContent>
                </Card>

                {/* Full dataset card */}
                <Card
                  role="radio"
                  aria-checked={tier === 'full'}
                  tabIndex={0}
                  onClick={() => setTier('full')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTier('full'); }}
                  className={[
                    'cursor-pointer transition-colors',
                    tier === 'full' ? 'border-primary ring-1 ring-primary' : 'hover:border-muted-foreground',
                  ].join(' ')}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Full Dataset</CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs text-muted-foreground">
                    All anonymized rows with animal-name contributors and pseudonym repos.
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Destination selector */}
            <div>
              <p className="text-sm font-medium mb-2">How to share</p>
              <div className="grid grid-cols-1 gap-3">
                {/* HTTP POST card — only shown if reachable */}
                {httpReachable && (
                  <div
                    role="radio"
                    aria-checked={destination === 'http'}
                    tabIndex={0}
                    onClick={() => setDestination('http')}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDestination('http'); }}
                    className={[
                      'rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                      destination === 'http'
                        ? 'border-primary ring-1 ring-primary'
                        : 'hover:border-muted-foreground',
                    ].join(' ')}
                  >
                    <p className="text-sm font-medium">Send to research endpoint</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      POST directly to the research data collection server.
                    </p>
                  </div>
                )}

                {/* Gist card */}
                <div
                  role="radio"
                  aria-checked={destination === 'gist'}
                  tabIndex={0}
                  onClick={() => setDestination('gist')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDestination('gist'); }}
                  className={[
                    'rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                    destination === 'gist'
                      ? 'border-primary ring-1 ring-primary'
                      : 'hover:border-muted-foreground',
                  ].join(' ')}
                >
                  <p className="text-sm font-medium">Save as Private GitHub Gist</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Creates a private gist with your anonymized data. Requires your PAT to have
                    <code className="font-mono mx-1">gist</code>scope.
                  </p>
                </div>

                {/* Manual download card */}
                <div
                  role="radio"
                  aria-checked={destination === 'manual'}
                  tabIndex={0}
                  onClick={() => setDestination('manual')}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDestination('manual'); }}
                  className={[
                    'rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                    destination === 'manual'
                      ? 'border-primary ring-1 ring-primary'
                      : 'hover:border-muted-foreground',
                  ].join(' ')}
                >
                  <p className="text-sm font-medium">Download sharing package</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Download a JSON file with anonymized data you can email or upload to share with the research team.
                  </p>
                </div>
              </div>
            </div>

            {/* Data preview */}
            {previewData && (
              <details className="rounded-md border">
                <summary className="text-sm font-medium cursor-pointer px-3 py-2 hover:bg-muted/50 rounded-md">
                  Preview what will be shared
                </summary>
                <pre className="text-xs font-mono bg-muted rounded-b-md p-3 overflow-auto max-h-48">
                  {JSON.stringify(previewData, null, 2)}
                </pre>
              </details>
            )}

            {/* Share error */}
            {shareResult?.error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 p-3"
              >
                <p className="text-sm text-destructive">{shareResult.error}</p>
              </div>
            )}
          </div>
        ) : (
          /* Success state — message varies by destination */
          <div className="rounded-md border border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30 p-4">
            {lastDestination === 'manual' ? (
              <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium">
                Sharing package downloaded. Email it or upload it to contribute to AI adoption research. Thank you!
              </p>
            ) : (
              <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium">
                Shared successfully. Thank you for contributing to AI adoption research.
              </p>
            )}
            {shareResult.gistUrl && (
              <a
                href={shareResult.gistUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block text-xs text-emerald-700 dark:text-emerald-400 underline hover:no-underline"
              >
                {shareResult.gistUrl}
              </a>
            )}
          </div>
        )}

        <AlertDialogFooter>
          {!shareResult?.success ? (
            <>
              <Button
                variant="ghost"
                onClick={handleDecline}
                disabled={sharing}
              >
                Decline Sharing
              </Button>
              <Button
                variant="default"
                onClick={handleShare}
                disabled={sharing || !exportBundle}
                className="flex items-center gap-2"
              >
                {sharing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sharing...
                  </>
                ) : (
                  'Share Data'
                )}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
