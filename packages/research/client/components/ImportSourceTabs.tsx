import { useState, useRef } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@shared/components/ui/tabs.js';
import { Button } from '@shared/components/ui/button.js';
import { Input } from '@shared/components/ui/input.js';
import { Loader2, Upload } from 'lucide-react';
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importFile = useImportFile();
  const importUrl = useImportUrl();
  const importBatch = useImportBatch();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importFile.mutateAsync(file).catch(err => ({
      success: false as const,
      errors: [err.message ?? 'Upload failed'],
    }));
    onImportComplete(result);
    if (result.success && result.orgId && onNavigateOrg) {
      onNavigateOrg(result.orgId);
    }
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const result = await importFile.mutateAsync(file).catch(err => ({
      success: false as const,
      errors: [err.message ?? 'Upload failed'],
    }));
    onImportComplete(result);
    if (result.success && result.orgId && onNavigateOrg) {
      onNavigateOrg(result.orgId);
    }
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
      <TabsList>
        <TabsTrigger value="file">Local File</TabsTrigger>
        <TabsTrigger value="gist">GitHub Gist URL</TabsTrigger>
        <TabsTrigger value="url">HTTP / Cloud URL</TabsTrigger>
        <TabsTrigger value="batch">Batch Directory</TabsTrigger>
      </TabsList>

      {/* Local File */}
      <TabsContent value="file" className="mt-4 space-y-3">
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop zone: drop a .zip or .json bundle, or click to browse"
          onDragOver={e => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
            dragActive
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-primary/50 hover:bg-muted/30'
          }`}
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop a <span className="font-medium">.zip</span> or <span className="font-medium">.json</span> bundle, or click to browse
          </p>
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
        <Button
          onClick={() => fileInputRef.current?.click()}
          disabled={isFileLoading}
          className="w-full sm:w-auto"
        >
          {isFileLoading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
          ) : (
            'Import Bundle'
          )}
        </Button>
      </TabsContent>

      {/* GitHub Gist URL */}
      <TabsContent value="gist" className="mt-4 space-y-3">
        <Input
          type="url"
          placeholder="Paste URL..."
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
          aria-label="GitHub Gist URL"
        />
        <Button
          onClick={handleUrlImport}
          disabled={isUrlLoading || !urlInput.trim()}
          className="w-full sm:w-auto"
        >
          {isUrlLoading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
          ) : (
            'Import Bundle'
          )}
        </Button>
      </TabsContent>

      {/* HTTP / Cloud URL */}
      <TabsContent value="url" className="mt-4 space-y-3">
        <Input
          type="url"
          placeholder="Paste URL..."
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
          aria-label="HTTP or cloud URL"
        />
        <Button
          onClick={handleUrlImport}
          disabled={isUrlLoading || !urlInput.trim()}
          className="w-full sm:w-auto"
        >
          {isUrlLoading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
          ) : (
            'Import Bundle'
          )}
        </Button>
      </TabsContent>

      {/* Batch Directory */}
      <TabsContent value="batch" className="mt-4 space-y-3">
        <Input
          type="text"
          placeholder="Paste directory path..."
          value={batchPath}
          onChange={e => setBatchPath(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleBatchImport(); }}
          aria-label="Directory path for batch import"
        />
        <Button
          onClick={handleBatchImport}
          disabled={isBatchLoading || !batchPath.trim()}
          className="w-full sm:w-auto"
        >
          {isBatchLoading ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Importing...</>
          ) : (
            'Import Bundle'
          )}
        </Button>
      </TabsContent>
    </Tabs>
  );
}
