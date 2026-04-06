import { useState, useMemo, useRef } from 'react';
import { Download, Info, Loader2 } from 'lucide-react';
import { zipSync, strToU8 } from 'fflate';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@shared/components/ui/dialog.js';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs.js';
import { Switch } from '@shared/components/ui/switch.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@shared/components/ui/table.js';
import { Button } from '@shared/components/ui/button.js';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@shared/components/ui/tooltip.js';
import { useExport, useIncrementExport } from '../hooks/useExport.js';
import { buildPseudonymMap, buildRepoMap, anonymizeBundle } from '../lib/anonymizer.js';
import { toCsv } from '../lib/csv-serializer.js';
import type { DashboardFilters } from '../hooks/useDashboardFilters.js';
import type { ExportBundle } from '@shared/export-types.js';
import type { ContributorBeforeAfterStats } from '@shared/types.js';

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DashboardFilters;
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function arrayToCsv(arr: Record<string, unknown>[]): string {
  if (arr.length === 0) return '';
  const headers = Object.keys(arr[0]);
  const rows = arr.map(row => headers.map(h => row[h] as string | number | null | undefined));
  return toCsv(headers, rows);
}

function contributorsToCsv(contributors: ContributorBeforeAfterStats[]): string {
  const headers = [
    'authorLogin', 'cohort', 'firstCommitAt',
    'pre_totalCommits', 'pre_totalPrs', 'pre_avgLinesAdded', 'pre_avgLinesDeleted', 'pre_avgFilesChanged',
    'post_totalCommits', 'post_totalPrs', 'post_avgLinesAdded', 'post_avgLinesDeleted', 'post_avgFilesChanged',
  ];
  const rows = contributors.map(c => [
    c.authorLogin,
    c.cohort,
    c.firstCommitAt,
    c.pre?.totalCommits ?? null,
    c.pre?.totalPrs ?? null,
    c.pre?.avgLinesAdded ?? null,
    c.pre?.avgLinesDeleted ?? null,
    c.pre?.avgFilesChanged ?? null,
    c.post?.totalCommits ?? null,
    c.post?.totalPrs ?? null,
    c.post?.avgLinesAdded ?? null,
    c.post?.avgLinesDeleted ?? null,
    c.post?.avgFilesChanged ?? null,
  ]);
  return toCsv(headers, rows);
}

function extractAllLogins(bundle: ExportBundle): string[] {
  return Array.from(new Set(bundle.contributors.map(c => c.authorLogin)));
}

// ─── ZIP creation ─────────────────────────────────────────────────────────────

function createAndDownloadZip(
  bundle: ExportBundle,
  format: 'csv' | 'json',
  anonymize: boolean
): void {
  let finalBundle = bundle;

  if (anonymize) {
    const logins = extractAllLogins(bundle);
    const repoNames = bundle.metadata.repoNames;
    const pseudonymMap = buildPseudonymMap(logins);
    const repoMap = buildRepoMap(repoNames);
    finalBundle = anonymizeBundle(bundle, pseudonymMap, repoMap);
  }

  const files: Record<string, Uint8Array> = {};

  // metadata.json always JSON regardless of format
  files['metadata.json'] = strToU8(JSON.stringify(finalBundle.metadata, null, 2));

  if (format === 'json') {
    files['cohort-commits.json'] = strToU8(JSON.stringify(finalBundle.cohortCommits, null, 2));
    files['cohort-prs.json'] = strToU8(JSON.stringify(finalBundle.cohortPrs, null, 2));
    files['ramp-up.json'] = strToU8(JSON.stringify(finalBundle.rampUp, null, 2));
    files['rolling-comparison.json'] = strToU8(JSON.stringify(finalBundle.rolling, null, 2));
    files['contributors.json'] = strToU8(JSON.stringify(finalBundle.contributors, null, 2));
    files['pr-turnaround.json'] = strToU8(JSON.stringify(finalBundle.prTurnaround, null, 2));
    files['bot-ratio.json'] = strToU8(JSON.stringify(finalBundle.botRatio, null, 2));
    if (finalBundle.executiveSummary) {
      files['executive-summary.json'] = strToU8(JSON.stringify(finalBundle.executiveSummary, null, 2));
    }
    if (finalBundle.beforeAfter) {
      files['before-after.json'] = strToU8(JSON.stringify(finalBundle.beforeAfter, null, 2));
    }
  } else {
    files['cohort-commits.csv'] = strToU8(arrayToCsv(finalBundle.cohortCommits as unknown as Record<string, unknown>[]));
    files['cohort-prs.csv'] = strToU8(arrayToCsv(finalBundle.cohortPrs as unknown as Record<string, unknown>[]));
    files['ramp-up.csv'] = strToU8(arrayToCsv(finalBundle.rampUp as unknown as Record<string, unknown>[]));
    files['contributors.csv'] = strToU8(contributorsToCsv(finalBundle.contributors));
    files['pr-turnaround.csv'] = strToU8(arrayToCsv(finalBundle.prTurnaround as unknown as Record<string, unknown>[]));
    files['bot-ratio.csv'] = strToU8(arrayToCsv(finalBundle.botRatio as unknown as Record<string, unknown>[]));
    // rolling and executive-summary are objects, not arrays — serialize as JSON even in CSV mode
    if (finalBundle.rolling) {
      files['rolling-comparison.json'] = strToU8(JSON.stringify(finalBundle.rolling, null, 2));
    }
    if (finalBundle.executiveSummary) {
      files['executive-summary.json'] = strToU8(JSON.stringify(finalBundle.executiveSummary, null, 2));
    }
    if (finalBundle.beforeAfter) {
      files['before-after.json'] = strToU8(JSON.stringify(finalBundle.beforeAfter, null, 2));
    }
  }

  const zip = zipSync(files);
  const date = new Date().toISOString().split('T')[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = new Blob([zip as any], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `git-data-explorer-export-${date}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── ExportModal component ────────────────────────────────────────────────────

export default function ExportModal({ open, onOpenChange, filters }: ExportModalProps) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [anonymize, setAnonymize] = useState(true);

  const exportMutation = useExport();
  const incrementExportMutation = useIncrementExport();

  // Store the raw fetched bundle for preview (before anonymization)
  const rawBundleRef = useRef<ExportBundle | null>(null);

  // When export data arrives, cache the raw bundle
  const exportData = exportMutation.data;
  if (exportData && rawBundleRef.current !== exportData) {
    rawBundleRef.current = exportData;
  }

  // Build preview rows from the bundle
  // Apply anonymization live based on the toggle — build maps once per bundle
  const previewRows = useMemo(() => {
    const bundle = rawBundleRef.current;
    if (!bundle || bundle.contributors.length === 0) return [];

    if (anonymize) {
      const logins = extractAllLogins(bundle);
      const repoNames = bundle.metadata.repoNames;
      const pseudonymMap = buildPseudonymMap(logins);
      const repoMap = buildRepoMap(repoNames);
      const anon = anonymizeBundle(bundle, pseudonymMap, repoMap);
      return anon.contributors.slice(0, 5);
    }
    return bundle.contributors.slice(0, 5);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportData, anonymize]);

  function handleDownload() {
    const exportRequest = {
      startDate: filters.startDate,
      endDate: filters.endDate,
      repoIds: filters.repoIds,
      tenureMode: filters.tenureMode,
      rollingGranularity: filters.rollingGranularity,
    };

    exportMutation.mutate(exportRequest, {
      onSuccess: (bundle) => {
        createAndDownloadZip(bundle, format, anonymize);
        incrementExportMutation.mutate();
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export Dashboard Data</DialogTitle>
          <DialogDescription>
            Download all dashboard data as a ZIP bundle. Includes cohort trends, contributor data,
            rolling metrics, and metadata.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Format selector */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Format:</span>
            <Tabs value={format} onValueChange={(v) => setFormat(v as 'csv' | 'json')}>
              <TabsList className="h-7">
                <TabsTrigger value="csv" className="text-xs px-3 py-1">
                  CSV
                </TabsTrigger>
                <TabsTrigger value="json" className="text-xs px-3 py-1">
                  JSON
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Anonymization toggle row */}
          <div className="flex items-center gap-3 min-h-[44px]">
            <Switch
              id="anon-toggle"
              checked={anonymize}
              onCheckedChange={setAnonymize}
            />
            <label htmlFor="anon-toggle" className="text-sm font-medium cursor-pointer">
              Anonymize contributor names (recommended)
            </label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  aria-label="Learn about anonymization"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Info className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  Contributors are replaced with unique animal names (e.g., Blue Falcon). The same
                  person always gets the same name within this export. Names are not stored —
                  exporting again produces different names.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Amber warning when anonymization is OFF */}
          {!anonymize && (
            <div
              role="alert"
              className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 border rounded-md p-3"
            >
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Contributor names will appear in the export. Ensure you have permission to share
                this data.
              </p>
            </div>
          )}

          {/* Preview section */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Preview (first 5 rows)</p>
            {exportData && previewRows.length > 0 ? (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <caption className="sr-only">
                    Preview of {anonymize ? 'anonymized' : ''} export data (first 5 rows)
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Contributor</TableHead>
                      <TableHead className="text-xs">Cohort</TableHead>
                      <TableHead className="text-xs text-right">Pre-AI PRs</TableHead>
                      <TableHead className="text-xs text-right">Post-AI PRs</TableHead>
                      <TableHead className="text-xs text-right">Change</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, i) => {
                      const prePrs = row.pre?.totalPrs ?? null;
                      const postPrs = row.post?.totalPrs ?? null;
                      const delta =
                        prePrs !== null && postPrs !== null ? postPrs - prePrs : null;
                      return (
                        <TableRow key={i}>
                          <TableCell className="text-xs font-mono">{row.authorLogin}</TableCell>
                          <TableCell className="text-xs">{row.cohort}</TableCell>
                          <TableCell className="text-xs text-right tabular-nums">
                            {prePrs !== null ? prePrs : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-right tabular-nums">
                            {postPrs !== null ? postPrs : '—'}
                          </TableCell>
                          <TableCell className="text-xs text-right tabular-nums">
                            {delta !== null ? (delta >= 0 ? `+${delta}` : String(delta)) : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : exportData && previewRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No contributor data available in the selected date range.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Click Download ZIP to prepare data.
              </p>
            )}

            {/* Export error */}
            {exportMutation.isError && (
              <p className="text-sm text-destructive">
                Export failed. Check your connection and try again.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="default"
            onClick={handleDownload}
            disabled={exportMutation.isPending}
            className="flex items-center gap-2"
          >
            {exportMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Preparing export...
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                Download ZIP
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
