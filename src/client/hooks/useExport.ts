import { useMutation, useQuery } from '@tanstack/react-query';
import type { ExportBundle, ExportRequest } from '@shared/export-types.js';

export function useExport() {
  return useMutation({
    mutationFn: async (req: ExportRequest): Promise<ExportBundle> => {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error((err as { error?: string }).error || 'Export failed');
      }
      return res.json();
    },
  });
}

export function useExportPreview(filters: ExportRequest | null, enabled: boolean) {
  return useQuery({
    queryKey: ['export-preview', filters],
    queryFn: async (): Promise<ExportBundle> => {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Preview failed' }));
        throw new Error((err as { error?: string }).error || 'Preview failed');
      }
      return res.json();
    },
    enabled: enabled && filters !== null,
    staleTime: 30_000, // Cache for 30s — don't re-fetch on every toggle
  });
}

export function useIncrementExport() {
  return useMutation({
    mutationFn: async (): Promise<{ exportCount: number }> => {
      const res = await fetch('/api/settings/sharing/increment-export', { method: 'POST' });
      if (!res.ok) {
        throw new Error('Failed to increment export count');
      }
      return res.json();
    },
  });
}
