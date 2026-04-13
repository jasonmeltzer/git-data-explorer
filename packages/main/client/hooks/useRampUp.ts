import { useQuery } from '@tanstack/react-query';
import type { RampUpBucket } from '@shared/types.js';

interface UseRampUpParams {
  tenureMode: 'global' | 'repo';
  repoIds: number[];
  joinPeriodGranularity: 'quarter' | 'half' | 'year';
}

export function useRampUp(params: UseRampUpParams) {
  const { tenureMode, repoIds, joinPeriodGranularity } = params;

  return useQuery<RampUpBucket[]>({
    queryKey: ['analytics', 'rampup', tenureMode, repoIds, joinPeriodGranularity],
    queryFn: async () => {
      const search = new URLSearchParams({
        tenureMode,
        joinPeriodGranularity,
      });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/rampup?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch ramp-up curves');
      return res.json();
    },
    staleTime: 30_000,
  });
}
