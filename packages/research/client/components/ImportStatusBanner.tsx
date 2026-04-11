import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { ImportResult } from '../hooks/useImport.js';

interface ImportStatusBannerProps {
  result: ImportResult | null;
  batchResults?: ImportResult[] | null;
}

export default function ImportStatusBanner({ result, batchResults }: ImportStatusBannerProps) {
  // Batch result summary
  if (batchResults && batchResults.length > 0) {
    const successCount = batchResults.filter(r => r.success).length;
    const failCount = batchResults.length - successCount;
    const allWarnings = batchResults.flatMap(r => r.warnings ?? []);
    const isFullSuccess = failCount === 0 && allWarnings.length === 0;
    const hasWarnings = failCount === 0 && allWarnings.length > 0;

    if (isFullSuccess) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-green-500/40 bg-green-500/10 p-4"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <p className="text-sm">
            Batch import complete. {successCount} bundle{successCount !== 1 ? 's' : ''} imported successfully.
          </p>
        </div>
      );
    }
    if (hasWarnings) {
      return (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-sm space-y-1">
            <p>Batch import complete with warnings. {successCount} bundle{successCount !== 1 ? 's' : ''} imported.</p>
            <ul className="list-disc list-inside text-muted-foreground">
              {allWarnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
              {allWarnings.length > 5 && <li>...and {allWarnings.length - 5} more</li>}
            </ul>
          </div>
        </div>
      );
    }
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
      >
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="text-sm">
          Batch import: {successCount} succeeded, {failCount} failed.
        </p>
      </div>
    );
  }

  if (!result) return null;

  const warnings = result.warnings ?? [];
  const errors = result.errors ?? [];

  if (!result.success || errors.length > 0) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
      >
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="text-sm">{errors.length > 0 ? errors.join('. ') : 'Import failed. Please try again.'}</p>
      </div>
    );
  }

  if (warnings.length > 0) {
    const label = result.orgLabel ?? `org ${result.orgId}`;
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="text-sm space-y-1">
          <p>Bundle imported with warnings: {warnings.length} section{warnings.length !== 1 ? 's' : ''} missing or empty. ({label})</p>
          <ul className="list-disc list-inside text-muted-foreground">
            {warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
            {warnings.length > 5 && <li>...and {warnings.length - 5} more</li>}
          </ul>
        </div>
      </div>
    );
  }

  const label = result.orgLabel ?? `org ${result.orgId}`;
  const sectionCount = 1; // we don't have section-level info from the API, use a generic message
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-lg border border-green-500/40 bg-green-500/10 p-4"
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      <p className="text-sm">
        Bundle imported. {sectionCount > 0 ? 'All sections loaded' : 'Data loaded'} from <span className="font-medium">{label}</span>.
        {result.isDuplicate && (
          <span className="ml-1 text-muted-foreground">(Duplicate — saved as new snapshot.)</span>
        )}
      </p>
    </div>
  );
}
