import { useQuery } from '@tanstack/react-query';
import type { ContributorBeforeAfterStats } from '@shared/types.js';

interface UseContributorBeforeAfterParams {
  startDate: string;
  endDate: string;
  tenureMode: 'global' | 'repo';
  repoIds: number[];
  aiMarkerDate: string | null;
}

export function useContributorBeforeAfter(params: UseContributorBeforeAfterParams) {
  const { startDate, endDate, tenureMode, repoIds, aiMarkerDate } = params;

  return useQuery<ContributorBeforeAfterStats[]>({
    queryKey: ['analytics', 'contributors', 'before-after', startDate, endDate, tenureMode, repoIds, aiMarkerDate],
    queryFn: async () => {
      const search = new URLSearchParams({
        startDate,
        endDate,
        tenureMode,
        aiMarkerDate: aiMarkerDate!,
      });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/contributors/before-after?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch contributor before/after stats');
      return res.json();
    },
    enabled: !!aiMarkerDate,
    staleTime: 30_000,
  });
}
