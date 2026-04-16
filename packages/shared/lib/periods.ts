import type { Period } from '../types.js';

/**
 * Build Period[] from a single AI marker date.
 * No marker: length-1 ["All-time"].
 * Single marker: length-2 ["Pre-AI", "Post-AI"].
 * Phase 10 will add multi-marker support via ai_markers table.
 */
export function buildPeriodsFromMarker(
  startDate: string,
  endDate: string,
  markerDate: string | null,
): Period[] {
  if (!markerDate) {
    return [{ startDate, endDate, label: 'All-time' }];
  }
  // Day before marker as end of first period
  const marker = new Date(markerDate);
  const preEnd = new Date(marker.getTime() - 86_400_000); // minus 1 day
  const preEndIso = preEnd.toISOString().slice(0, 10);     // YYYY-MM-DD

  return [
    { startDate, endDate: preEndIso, label: 'Pre-AI', markerDate },
    { startDate: markerDate, endDate, label: 'Post-AI', markerDate },
  ];
}
