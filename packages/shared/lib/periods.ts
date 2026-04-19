import type { Period } from '../types.js';

/**
 * Build Period[] from a single AI marker date.
 *
 * All date inputs MUST be `YYYY-MM-DD` strings (date-only ISO 8601). Full
 * timestamps with timezone offsets would be parsed as wall-clock-local by
 * `new Date()` and produce wrong "day before marker" arithmetic. The function
 * defends against accidental timestamp input by slicing to 10 chars before
 * parsing.
 *
 * No marker: length-1 [{ label: 'All-time' }].
 * Single marker: length-2 [{ label: 'Pre-AI', markerDate }, { label: 'Post-AI', markerDate }].
 * Phase 10 will add multi-marker support via ai_markers table.
 */
export function buildPeriodsFromMarker(
  startDate: string,
  endDate: string,
  markerDate: string | null,
): Period[] {
  const start = startDate.slice(0, 10);
  const end = endDate.slice(0, 10);

  if (!markerDate) {
    return [{ startDate: start, endDate: end, label: 'All-time' }];
  }
  const marker = markerDate.slice(0, 10);
  // Day before marker as end of first period. Date.UTC + 10-char slice
  // guarantees UTC parsing regardless of caller timezone.
  const [my, mm, md] = marker.split('-').map(Number);
  const markerEpochMs = Date.UTC(my, mm - 1, md);
  const preEndIso = new Date(markerEpochMs - 86_400_000).toISOString().slice(0, 10);

  return [
    { startDate: start, endDate: preEndIso, label: 'Pre-AI', markerDate: marker },
    { startDate: marker, endDate: end, label: 'Post-AI', markerDate: marker },
  ];
}
