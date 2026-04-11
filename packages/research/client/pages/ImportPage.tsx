import { useState } from 'react';
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
      <h1 className="text-3xl font-semibold mt-12">Import Data Bundle</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Load an exported bundle from any source
      </p>
      <div className="mt-8">
        <ImportSourceTabs
          onImportComplete={handleImportComplete}
          onNavigateOrg={handleNavigateOrg}
        />
      </div>
      {(lastResult !== null || (batchResults && batchResults.length > 0)) && (
        <div className="mt-6">
          <ImportStatusBanner result={lastResult} batchResults={batchResults} />
        </div>
      )}
    </div>
  );
}
