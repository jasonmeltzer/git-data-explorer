import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CohortConfig } from '@shared/cohort-config.js';

export function useCohortConfig() {
  const queryClient = useQueryClient();

  const query = useQuery<CohortConfig>({
    queryKey: ['analytics', 'cohort-config'],
    queryFn: () => fetch('/api/analytics/cohort-config').then(r => r.json()),
  });

  const mutation = useMutation({
    mutationFn: (config: CohortConfig) =>
      fetch('/api/analytics/cohort-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    saveConfig: mutation.mutateAsync,
    isSaving: mutation.isPending,
  };
}
