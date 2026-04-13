import type { RollingComparisonResult, CohortMetricsRow } from '@shared/types.js';
import { COHORT_LABELS } from '@shared/cohort-config.js';

export function rollingNarrative(
  result: RollingComparisonResult,
  metricKey: keyof RollingComparisonResult['changes']
): string {
  const value = result.changes[metricKey];
  if (value === null) return `No prior period data for comparison.`;
  const dir = value >= 0 ? 'up' : 'down';
  const pct = Math.abs(Math.round(value));
  const metricLabels: Record<string, string> = {
    commitSize: 'Average commit size',
    prSize: 'Average PR size',
    commitFrequency: 'Commit activity',
    prFrequency: 'PR activity',
  };
  const label = metricLabels[metricKey] || metricKey;
  return `${label} is ${dir} ${pct}% ${result.granularity}-over-${result.granularity} (${result.prior.label} to ${result.current.label}).`;
}

export function cohortTrendNarrative(
  rows: CohortMetricsRow[],
  metric: 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount',
  label: string
): string {
  if (rows.length === 0) return 'No data available for this period.';
  const months = [...new Set(rows.map(r => r.periodMonth))].sort();
  if (months.length < 2) return `${label}: only one period of data available.`;
  const first = months[0];
  const last = months[months.length - 1];

  const cohorts = [...new Set(rows.map(r => r.cohort))];
  const parts: string[] = [];
  for (const cohort of ['0-3mo', '3-12mo', '1yr+']) {
    if (!cohorts.includes(cohort)) continue;
    const firstVal = rows.find(r => r.periodMonth === first && r.cohort === cohort)?.[metric] ?? 0;
    const lastVal = rows.find(r => r.periodMonth === last && r.cohort === cohort)?.[metric] ?? 0;
    if (firstVal === 0) continue;
    const change = Math.round(((lastVal - firstVal) / firstVal) * 100);
    const dir = change >= 0 ? 'up' : 'down';
    parts.push(`${COHORT_LABELS[cohort] ?? cohort} ${dir} ${Math.abs(change)}%`);
  }

  if (parts.length === 0) return `${label} from ${first} to ${last}.`;
  return `${label} (${first} to ${last}): ${parts.join(', ')}.`;
}
