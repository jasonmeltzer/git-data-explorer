import { useQuery } from '@tanstack/react-query';
import type { DeveloperMonthlyRow } from '@shared/types.js';

interface UseDeveloperMonthlyParams {
  startDate: string;
  endDate: string;
  repoIds: number[];
}

/**
 * Phase 9.5 (D-25, D-02): TanStack Query hook for the new
 * GET /api/analytics/developer-monthly endpoint.
 *
 * The queryKey includes [startDate, endDate, repoIds] so cache auto-refetches
 * when the dashboard filter changes — Layout A/C threshold (8) is computed
 * downstream from the returned data, so refetching is the only mechanism that
 * keeps layout in sync with filter changes.
 */
export function useDeveloperMonthly(params: UseDeveloperMonthlyParams) {
  const { startDate, endDate, repoIds } = params;

  return useQuery<DeveloperMonthlyRow[]>({
    queryKey: ['analytics', 'developer-monthly', startDate, endDate, repoIds],
    queryFn: async () => {
      const search = new URLSearchParams({ startDate, endDate });
      if (repoIds.length > 0) {
        search.set('repoIds', repoIds.join(','));
      }
      const res = await fetch(`/api/analytics/developer-monthly?${search.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch developer-monthly data');
      return res.json();
    },
    staleTime: 30_000,
  });
}
