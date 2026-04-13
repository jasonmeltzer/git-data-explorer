import { useQuery } from '@tanstack/react-query';

export interface BeforeAfterMetrics {
  avgCommitSize: number;
  prFrequency: number;
  rampUpSpeed: number;
  activeContributors: number;
}

export interface BeforeAfterData {
  before: BeforeAfterMetrics;
  after: BeforeAfterMetrics;
  aiMarkerDate: string;
}

interface UseBeforeAfterParams {
  repoIds: number[];
}

export function useBeforeAfter(params: UseBeforeAfterParams) {
  const { repoIds } = params;

  return useQuery<BeforeAfterData>({
    queryKey: ['analytics', 'before-after', repoIds],
    queryFn: async () => {
      const search = new URLSearchParams();
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/before-after?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch before/after data');
      return res.json();
    },
    staleTime: 30_000,
  });
}
