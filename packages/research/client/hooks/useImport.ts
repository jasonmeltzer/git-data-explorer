import { useMutation, useQueryClient } from '@tanstack/react-query';

export interface ImportResult {
  success: boolean;
  orgId?: number;
  snapshotId?: number;
  orgLabel?: string;
  warnings?: string[];
  isDuplicate?: boolean;
  crossOrgDuplicate?: { otherOrgName: string; importedAt: string };
  fuzzyMatch?: { otherOrgName: string; overlapReason: string; importedAt: string };
  errors?: string[];
}

export function useImportFile() {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, Error, File>({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return fetch('/api/import/file', {
        method: 'POST',
        body: formData,
      }).then(r => r.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useImportUrl() {
  const queryClient = useQueryClient();
  return useMutation<ImportResult, Error, string>({
    mutationFn: (url: string) =>
      fetch('/api/import/url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useImportBatch() {
  const queryClient = useQueryClient();
  return useMutation<{ success: boolean; results: ImportResult[] }, Error, string>({
    mutationFn: (directoryPath: string) =>
      fetch('/api/import/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directoryPath }),
      }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs'] }),
  });
}
