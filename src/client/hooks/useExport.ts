import { useMutation } from '@tanstack/react-query';
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

export function useIncrementExport() {
  return useMutation({
    mutationFn: async (): Promise<{ exportCount: number }> => {
      const res = await fetch('/api/settings/sharing/increment-export', { method: 'POST' });
      return res.json();
    },
  });
}
