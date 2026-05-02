import type { RollingComparisonResult, CohortMetricsRow, ConcentrationBasis } from '@shared/types.js';
import { COHORT_LABELS, COHORT_KEYS } from '@shared/cohort-config.js';

export type MetricOption = 'totalCount' | 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged';

export const METRIC_OPTIONS: { label: string; value: MetricOption }[] = [
  { label: 'Count', value: 'totalCount' },
  { label: 'Lines Added', value: 'avgLinesAdded' },
  { label: 'Lines Deleted', value: 'avgLinesDeleted' },
  { label: 'Files Changed', value: 'avgFilesChanged' },
];

/**
 * Phase 9.5 (D-03): Metric tabs for the per-developer "Contribution Patterns"
 * section on DashboardPage and OrgDashboard. Section-local enum so it doesn't
 * pollute the cohort-section METRIC_OPTIONS namespace.
 *
 * Default tab = 'prCount' per D-03.
 * Tab labels are LITERALS (verbatim per D-03): "PRs", "Commits", "Lines per commit", "Files per commit".
 */
export type DeveloperMetricOption = 'prCount' | 'commitCount' | 'linesPerCommit' | 'filesPerCommit';

export const DEVELOPER_METRIC_OPTIONS: { label: string; value: DeveloperMetricOption }[] = [
  { label: 'PRs', value: 'prCount' },
  { label: 'Commits', value: 'commitCount' },
  { label: 'Lines per commit', value: 'linesPerCommit' },
  { label: 'Files per commit', value: 'filesPerCommit' },
];

export const CONCENTRATION_BASIS_OPTIONS: { label: string; value: ConcentrationBasis }[] = [
  { label: 'PRs', value: 'prs' },
  { label: 'Commits', value: 'commits' },
  { label: 'Lines', value: 'lines' },
];

export const METRIC_NARRATIVE_LABELS: Record<MetricOption, { pr: string; commit: string }> = {
  totalCount: { pr: 'PR volume', commit: 'Commit volume' },
  avgLinesAdded: { pr: 'Avg lines added per PR', commit: 'Avg lines added per commit' },
  avgLinesDeleted: { pr: 'Avg lines deleted per PR', commit: 'Avg lines deleted per commit' },
  avgFilesChanged: { pr: 'Avg files changed per PR', commit: 'Avg files changed per commit' },
};

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
  metric: MetricOption,
  label: string
): string {
  if (rows.length === 0) return 'No data available for this period.';
  const months = [...new Set(rows.map(r => r.periodMonth))].sort();
  if (months.length < 2) return `${label}: only one period of data available.`;
  const first = months[0];
  const last = months[months.length - 1];

  const cohorts = [...new Set(rows.map(r => r.cohort))];
  const parts: string[] = [];
  for (const cohort of COHORT_KEYS) {
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
