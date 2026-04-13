import { useQuery } from '@tanstack/react-query';

export interface BotRatioRow {
  periodMonth: string;
  totalCommits: number;
  botCommits: number;
  humanCommits: number;
  botPercentage: number;
}

interface UseBotRatioParams {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

export function useBotRatio(params: UseBotRatioParams) {
  const { startDate, endDate, repoIds } = params;

  return useQuery<BotRatioRow[]>({
    queryKey: ['analytics', 'bot-ratio', startDate, endDate, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({ startDate, endDate });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/bot-ratio?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch bot ratio data');
      return res.json();
    },
    staleTime: 30_000,
  });
}
