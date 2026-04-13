import { useQuery } from '@tanstack/react-query';

export interface PrTurnaroundRow {
  periodMonth: string;
  avgHoursToMerge: number;
  prCount: number;
}

interface UsePrTurnaroundParams {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

export function usePrTurnaround(params: UsePrTurnaroundParams) {
  const { startDate, endDate, repoIds } = params;

  return useQuery<PrTurnaroundRow[]>({
    queryKey: ['analytics', 'pr-turnaround', startDate, endDate, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({ startDate, endDate });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/pr-turnaround?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch PR turnaround data');
      return res.json();
    },
    staleTime: 30_000,
  });
}
