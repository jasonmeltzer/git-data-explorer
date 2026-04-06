import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface SharingStatus {
  promptShown: boolean;
  declined: boolean;
  enabled: boolean;
  exportCount: number;
}

export function useSharingStatus() {
  return useQuery({
    queryKey: ['settings', 'sharing'],
    queryFn: async (): Promise<SharingStatus> => {
      const res = await fetch('/api/settings/sharing');
      return res.json();
    },
  });
}

export function useDeclineSharing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/settings/sharing/decline', { method: 'PUT' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'sharing'] }),
  });
}

export function useEnableSharing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/settings/sharing/enable', { method: 'PUT' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'sharing'] }),
  });
}

export function useDisableSharing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/settings/sharing/disable', { method: 'PUT' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'sharing'] }),
  });
}

export function useMarkPromptShown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch('/api/settings/sharing/prompt-shown', { method: 'PUT' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'sharing'] }),
  });
}
