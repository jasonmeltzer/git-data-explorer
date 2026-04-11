import { useQuery } from '@tanstack/react-query';
import type { ExportBundle } from '@shared/export-types.js';

export function useSnapshotData(orgId: number | null, snapshotId: number | null) {
  return useQuery<ExportBundle>({
    queryKey: ['snapshot-data', orgId, snapshotId],
    queryFn: () =>
      fetch(`/api/orgs/${orgId}/snapshots/${snapshotId}/data`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    enabled: orgId != null && snapshotId != null,
  });
}
