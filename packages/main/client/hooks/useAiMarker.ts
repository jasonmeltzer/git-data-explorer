import { useQuery } from '@tanstack/react-query';

interface AiMarkerResponse {
  date: string | null;
}

export function useAiMarker() {
  return useQuery<AiMarkerResponse>({
    queryKey: ['analytics', 'marker'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/marker');
      if (!res.ok) throw new Error('Failed to fetch AI marker date');
      return res.json();
    },
    staleTime: 30_000,
  });
}
