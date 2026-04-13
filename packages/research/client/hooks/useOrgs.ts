import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export interface OrgSummary {
  id: number;
  label: string;
  sizeCategory: string | null;
  industry: string | null;
  aiTool: string | null;
  importSource: string;
  createdAt: string;
  snapshotCount: number;
}

export interface Snapshot {
  id: number;
  orgId: number;
  importedAt: string;
  startDate: string | null;
  endDate: string | null;
  contributorCount: number | null;
  repoCount: number | null;
  isDuplicate: number;
}

export interface OrgDetail extends OrgSummary {
  snapshots: Snapshot[];
}

export function useOrgs() {
  return useQuery<OrgSummary[]>({
    queryKey: ['orgs'],
    queryFn: () => fetch('/api/orgs').then(r => r.json()),
  });
}

export function useOrg(orgId: number | null) {
  return useQuery<OrgDetail>({
    queryKey: ['orgs', orgId],
    queryFn: () => fetch(`/api/orgs/${orgId}`).then(r => r.json()),
    enabled: orgId != null,
  });
}

export function useDeleteOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orgId: number) =>
      fetch(`/api/orgs/${orgId}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orgs'] }),
  });
}

export function useUpdateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: {
      orgId: number;
      data: {
        label?: string;
        sizeCategory?: string;
        industry?: string;
        aiTool?: string;
      };
    }) =>
      fetch(`/api/orgs/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }).then(r => r.json()),
    onSuccess: (_data, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
      queryClient.invalidateQueries({ queryKey: ['orgs', orgId] });
    },
  });
}

export function useDeleteSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, snapshotId }: { orgId: number; snapshotId: number }) =>
      fetch(`/api/orgs/${orgId}/snapshots/${snapshotId}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: (_data, { orgId }) => {
      queryClient.invalidateQueries({ queryKey: ['orgs'] });
      queryClient.invalidateQueries({ queryKey: ['orgs', orgId] });
    },
  });
}
