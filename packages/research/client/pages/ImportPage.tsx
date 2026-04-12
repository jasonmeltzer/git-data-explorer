import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/components/ui/card.js';
import ImportSourceTabs from '../components/ImportSourceTabs.js';
import ImportStatusBanner from '../components/ImportStatusBanner.js';
import type { ImportResult } from '../hooks/useImport.js';

export default function ImportPage() {
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [batchResults, setBatchResults] = useState<ImportResult[] | null>(null);

  const handleImportComplete = (result: ImportResult | null, batch?: ImportResult[] | null) => {
    setLastResult(result);
    setBatchResults(batch ?? null);
  };

  const handleNavigateOrg = (orgId: number) => {
    window.location.hash = `#/org/${orgId}`;
  };

  return (
    <div className="max-w-2xl mx-auto px-4 pb-12">
      <div className="mt-12 mb-8">
        <h1 className="text-3xl font-semibold text-foreground">Import Data Bundle</h1>
        <p className="text-muted-foreground mt-2">
          Load exported bundles from Git Data Explorer to analyze contribution
          patterns across organizations — no GitHub token required.
        </p>
      </div>

      {(lastResult !== null || (batchResults && batchResults.length > 0)) && (
        <div className="mb-6">
          <ImportStatusBanner result={lastResult} batchResults={batchResults} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Choose a source</CardTitle>
          <CardDescription>
            Import a <code className="text-xs bg-muted px-1 py-0.5 rounded">.zip</code> or{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">.json</code> bundle
            exported from any Git Data Explorer instance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ImportSourceTabs
            onImportComplete={handleImportComplete}
            onNavigateOrg={handleNavigateOrg}
          />
        </CardContent>
      </Card>
    </div>
  );
}
