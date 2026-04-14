import { useState, useRef } from 'react';
import { Card, CardContent } from '@shared/components/ui/card.js';
import { Button } from '@shared/components/ui/button.js';
import { Input } from '@shared/components/ui/input.js';
import { Loader2, Upload, Link, Globe, FolderOpen } from 'lucide-react';
import { useImportFile, useImportUrl, useImportBatch } from '../hooks/useImport.js';
import type { ImportResult } from '../hooks/useImport.js';
import ImportStatusBanner from '../components/ImportStatusBanner.js';

/** Check whether an import result contains any cross-org or fuzzy-match warnings */
function hasWarnings(result: ImportResult): boolean {
  if (!result.success) return false;
  if (result.crossOrgDuplicate) return true;
  if (result.fuzzyMatch) return true;
  if (result.warnings && result.warnings.length > 0) return true;
  return false;
}

export default function ImportPage() {
  const [lastResult, setLastResult] = useState<ImportResult | null>(null);
  const [batchResults, setBatchResults] = useState<ImportResult[] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [batchPath, setBatchPath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFile = useImportFile();
  const importUrl = useImportUrl();
  const importBatch = useImportBatch();

  const clearResults = () => { setLastResult(null); setBatchResults(null); };

  const handleFileSelect = async (file: File) => {
    clearResults();
    const result = await importFile.mutateAsync(file).catch(err => ({
      success: false as const,
      errors: [err.message ?? 'Upload failed'],
    }));
    setLastResult(result);
    if (result.success && result.orgId && !hasWarnings(result)) {
      window.location.hash = `#/org/${result.orgId}`;
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) return;
    clearResults();
    const result = await importUrl.mutateAsync(urlInput.trim()).catch(err => ({
      success: false as const,
      errors: [err.message ?? 'URL import failed'],
    }));
    setLastResult(result);
    if (result.success && result.orgId && !hasWarnings(result)) {
      window.location.hash = `#/org/${result.orgId}`;
    }
  };

  const handleBatchImport = async () => {
    if (!batchPath.trim()) return;
    clearResults();
    const response = await importBatch.mutateAsync(batchPath.trim()).catch(err => ({
      success: false as const,
      results: [{ success: false, errors: [err.message ?? 'Batch import failed'] }],
    }));
    setBatchResults(response.results);
  };

  const hasResults = lastResult !== null || (batchResults && batchResults.length > 0);

  return (
    <div className="max-w-4xl mx-auto px-6 pb-16">
      {/* Header */}
      <div className="pt-12 pb-10">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          Import Data
        </h1>
        <p className="text-base text-muted-foreground mt-2 max-w-xl">
          Load exported bundles from Git Data Explorer to analyze AI adoption
          patterns across organizations. No GitHub token required.
        </p>
      </div>

      {/* Status banner */}
      {hasResults && (
        <div className="mb-8">
          <ImportStatusBanner result={lastResult} batchResults={batchResults} />
          {lastResult?.success && lastResult.orgId && hasWarnings(lastResult) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => { window.location.hash = `#/org/${lastResult.orgId}`; }}
            >
              Continue to dashboard
            </Button>
          )}
        </div>
      )}

      {/* ── Primary: File Upload ──────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop zone: drop a .zip or .json bundle, or click to browse"
        onDragOver={e => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
        className={`group relative rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
          dragActive
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border hover:border-primary/40 hover:bg-muted/40'
        }`}
      >
        <div className="flex flex-col items-center justify-center py-16 px-8">
          {importFile.isPending ? (
            <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
          ) : (
            <div className={`rounded-full p-4 mb-4 transition-colors ${
              dragActive ? 'bg-primary/10' : 'bg-muted group-hover:bg-primary/10'
            }`}>
              <Upload className={`h-8 w-8 transition-colors ${
                dragActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'
              }`} />
            </div>
          )}
          <p className="text-lg font-medium text-foreground">
            {importFile.isPending ? 'Importing...' : 'Drop a file here, or click to browse'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Accepts <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">.zip</code>{' '}
            and <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">.json</code>{' '}
            export bundles
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.json"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
          tabIndex={-1}
        />
      </div>

      {/* ── Secondary: Other Import Methods ───────────────────── */}
      <div className="mt-10">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Other import methods
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Gist URL */}
          <Card className="relative">
            <CardContent className="pt-5 pb-5 px-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="rounded-md bg-muted p-1.5">
                  <Link className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium text-foreground">GitHub Gist</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Paste a Gist URL containing an exported JSON bundle.
              </p>
              <div className="space-y-2">
                <Input
                  type="url"
                  placeholder="https://gist.github.com/..."
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
                  className="text-xs h-8"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={handleUrlImport}
                  disabled={importUrl.isPending || !urlInput.trim()}
                >
                  {importUrl.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : null}
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* HTTP URL */}
          <Card className="relative">
            <CardContent className="pt-5 pb-5 px-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="rounded-md bg-muted p-1.5">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium text-foreground">HTTP URL</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Direct link to a hosted .zip or .json bundle.
              </p>
              <div className="space-y-2">
                <Input
                  type="url"
                  placeholder="https://example.com/bundle.zip"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
                  className="text-xs h-8"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={handleUrlImport}
                  disabled={importUrl.isPending || !urlInput.trim()}
                >
                  {importUrl.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : null}
                  Import
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Batch Directory */}
          <Card className="relative">
            <CardContent className="pt-5 pb-5 px-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="rounded-md bg-muted p-1.5">
                  <FolderOpen className="h-4 w-4 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium text-foreground">Batch Directory</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                Import all bundles from a local directory at once.
              </p>
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="/path/to/bundles/"
                  value={batchPath}
                  onChange={e => setBatchPath(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleBatchImport(); }}
                  className="text-xs h-8"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={handleBatchImport}
                  disabled={importBatch.isPending || !batchPath.trim()}
                >
                  {importBatch.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : null}
                  Import All
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
