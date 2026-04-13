import { useQuery } from '@tanstack/react-query';
import type { CohortMetricsRow } from '@shared/types.js';

interface UseCohortPrsParams {
  startDate: string;
  endDate: string;
  tenureMode: 'global' | 'repo';
  repoIds: number[];
}

export function useCohortPrs(params: UseCohortPrsParams) {
  const { startDate, endDate, tenureMode, repoIds } = params;

  return useQuery<CohortMetricsRow[]>({
    queryKey: ['analytics', 'cohorts', 'prs', startDate, endDate, tenureMode, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({
        startDate,
        endDate,
        tenureMode,
      });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/cohorts/prs?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch cohort PR metrics');
      return res.json();
    },
    staleTime: 30_000,
  });
}
