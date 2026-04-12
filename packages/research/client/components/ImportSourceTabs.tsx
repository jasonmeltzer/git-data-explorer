import { useState, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@shared/components/ui/tabs.js';
import { Button } from '@shared/components/ui/button.js';
import { Input } from '@shared/components/ui/input.js';
import { Loader2, Upload, Link, FolderOpen, FileText } from 'lucide-react';
import { useImportFile, useImportUrl, useImportBatch } from '../hooks/useImport.js';
import type { ImportResult } from '../hooks/useImport.js';

interface ImportSourceTabsProps {
  onImportComplete: (result: ImportResult | null, batchResults?: ImportResult[] | null) => void;
  onNavigateOrg?: (orgId: number) => void;
}

export default function ImportSourceTabs({ onImportComplete, onNavigateOrg }: ImportSourceTabsProps) {
  const [urlInput, setUrlInput] = useState('');
  const [batchPath, setBatchPath] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFile = useImportFile();
  const importUrl = useImportUrl();
  const importBatch = useImportBatch();

  const handleFileSelect = (file: File) => {
    setSelectedFile(file.name);
    doFileImport(file);
  };

  const doFileImport = async (file: File) => {
    const result = await importFile.mutateAsync(file).catch(err => ({
      success: false as const,
      errors: [err.message ?? 'Upload failed'],
    }));
    onImportComplete(result);
    setSelectedFile(null);
    if (result.success && result.orgId && onNavigateOrg) {
      onNavigateOrg(result.orgId);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) return;
    const result = await importUrl.mutateAsync(urlInput.trim()).catch(err => ({
      success: false as const,
      errors: [err.message ?? 'URL import failed'],
    }));
    onImportComplete(result);
    if (result.success && result.orgId && onNavigateOrg) {
      onNavigateOrg(result.orgId);
    }
  };

  const handleBatchImport = async () => {
    if (!batchPath.trim()) return;
    const response = await importBatch.mutateAsync(batchPath.trim()).catch(err => ({
      success: false as const,
      results: [{ success: false, errors: [err.message ?? 'Batch import failed'] }],
    }));
    onImportComplete(null, response.results);
  };

  const isFileLoading = importFile.isPending;
  const isUrlLoading = importUrl.isPending;
  const isBatchLoading = importBatch.isPending;

  return (
    <Tabs defaultValue="file">
      <TabsList className="w-full grid grid-cols-4">
        <TabsTrigger value="file" className="text-xs sm:text-sm">Local File</TabsTrigger>
        <TabsTrigger value="gist" className="text-xs sm:text-sm">Gist URL</TabsTrigger>
        <TabsTrigger value="url" className="text-xs sm:text-sm">HTTP URL</TabsTrigger>
        <TabsTrigger value="batch" className="text-xs sm:text-sm">Batch</TabsTrigger>
      </TabsList>

      {/* ── Local File ─────────────────────────────────────────── */}
      <TabsContent value="file" className="mt-6">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop zone: drop a .zip or .json bundle, or click to browse"
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-12 px-6 text-center cursor-pointer transition-colors ${
            dragActive
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/30'
          }`}
        >
          {isFileLoading ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : (
            <Upload className="h-10 w-10 text-muted-foreground" />
          )}
          {selectedFile ? (
            <p className="text-sm font-medium text-foreground">{selectedFile}</p>
          ) : (
            <>
              <p className="text-sm text-foreground font-medium">
                Drop a file here, or click to browse
              </p>
              <p className="text-xs text-muted-foreground">
                Accepts <code className="bg-muted px-1 py-0.5 rounded">.zip</code> and{' '}
                <code className="bg-muted px-1 py-0.5 rounded">.json</code> export bundles
              </p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json"
            className="sr-only"
            aria-label="Select .zip or .json bundle file"
            onChange={handleFileChange}
            tabIndex={-1}
          />
        </div>
      </TabsContent>

      {/* ── GitHub Gist URL ────────────────────────────────────── */}
      <TabsContent value="gist" className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Paste a GitHub Gist URL containing an exported JSON bundle.
            Both public and secret gists are supported.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Link className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="url"
              placeholder="https://gist.github.com/user/abc123..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
              aria-label="GitHub Gist URL"
              className="pl-9"
            />
          </div>
          <Button
            onClick={handleUrlImport}
            disabled={isUrlLoading || !urlInput.trim()}
          >
            {isUrlLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Import'
            )}
          </Button>
        </div>
      </TabsContent>

      {/* ── HTTP / Cloud URL ───────────────────────────────────── */}
      <TabsContent value="url" className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Paste a direct URL to a <code className="bg-muted px-1 py-0.5 rounded text-xs">.json</code> or{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">.zip</code> bundle
            hosted anywhere (S3, Dropbox, etc.).
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <FileText className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="url"
              placeholder="https://example.com/export-bundle.zip"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
              aria-label="HTTP or cloud URL"
              className="pl-9"
            />
          </div>
          <Button
            onClick={handleUrlImport}
            disabled={isUrlLoading || !urlInput.trim()}
          >
            {isUrlLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Import'
            )}
          </Button>
        </div>
      </TabsContent>

      {/* ── Batch Directory ────────────────────────────────────── */}
      <TabsContent value="batch" className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            Point to a local directory containing multiple{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">.json</code> or{' '}
            <code className="bg-muted px-1 py-0.5 rounded text-xs">.zip</code> bundles.
            Each file will be imported as a separate org snapshot.
          </p>
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="/path/to/export-bundles/"
              value={batchPath}
              onChange={e => setBatchPath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleBatchImport(); }}
              aria-label="Directory path for batch import"
              className="pl-9"
            />
          </div>
          <Button
            onClick={handleBatchImport}
            disabled={isBatchLoading || !batchPath.trim()}
          >
            {isBatchLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              'Import All'
            )}
          </Button>
        </div>
      </TabsContent>
    </Tabs>
  );
}
