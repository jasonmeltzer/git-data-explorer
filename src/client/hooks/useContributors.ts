import { useQuery } from '@tanstack/react-query';
import type { ContributorStats } from '@shared/types.js';

interface UseContributorsParams {
  startDate: string;
  endDate: string;
  tenureMode: 'global' | 'repo';
  repoIds: number[];
}

export function useContributors(params: UseContributorsParams) {
  const { startDate, endDate, tenureMode, repoIds } = params;

  return useQuery<ContributorStats[]>({
    queryKey: ['analytics', 'contributors', startDate, endDate, tenureMode, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({
        startDate,
        endDate,
        tenureMode,
      });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/contributors?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch contributor stats');
      return res.json();
    },
    staleTime: 30_000,
  });
}
