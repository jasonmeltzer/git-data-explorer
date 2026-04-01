import { useQuery } from '@tanstack/react-query';

export interface ExecutiveSummaryData {
  totalCommits: number;
  activeContributors: number;
  rampUpTrend: string | null;
  aiAdoptionDelta: string | null;
}

interface UseExecutiveSummaryParams {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

export function useExecutiveSummary(params: UseExecutiveSummaryParams) {
  const { startDate, endDate, repoIds } = params;

  return useQuery<ExecutiveSummaryData>({
    queryKey: ['analytics', 'summary', startDate, endDate, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({ startDate, endDate });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/summary?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch executive summary data');
      return res.json();
    },
    staleTime: 30_000,
  });
}
