import { useQuery } from '@tanstack/react-query';
import type { RollingComparisonResult } from '@shared/types.js';

interface UseRollingParams {
  granularity: 'month' | 'quarter';
  repoIds: number[];
}

export function useRolling(params: UseRollingParams) {
  const { granularity, repoIds } = params;

  return useQuery<RollingComparisonResult>({
    queryKey: ['analytics', 'rolling', granularity, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({ granularity });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/rolling?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch rolling comparison');
      return res.json();
    },
    staleTime: 30_000,
  });
}
