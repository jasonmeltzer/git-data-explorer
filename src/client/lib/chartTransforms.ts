import type { CohortMetricsRow } from '@shared/types.js';

export interface ChartPoint {
  month: number;  // epoch ms
  new: number;
  mid: number;
  senior: number;
}

export function cohortRowsToChartData(
  rows: CohortMetricsRow[],
  metric: 'avgLinesAdded' | 'avgLinesDeleted' | 'avgFilesChanged' | 'totalCount'
): ChartPoint[] {
  const byMonth = new Map<string, ChartPoint>();
  for (const row of rows) {
    if (!byMonth.has(row.periodMonth)) {
      byMonth.set(row.periodMonth, {
        month: new Date(row.periodMonth + '-01T00:00:00Z').getTime(),
        new: 0, mid: 0, senior: 0,
      });
    }
    const point = byMonth.get(row.periodMonth)!;
    if (row.cohort === '0-3mo')  point.new    = row[metric];
    if (row.cohort === '3-12mo') point.mid    = row[metric];
    if (row.cohort === '1yr+')   point.senior = row[metric];
  }
  return Array.from(byMonth.values()).sort((a, b) => a.month - b.month);
}
